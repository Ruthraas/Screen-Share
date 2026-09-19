import { useEffect, useRef, useState } from "react";
import { connectSignaling, type ServerEvent, type SignalingHandle } from "../../services/signalingClient";
import { fetchTurnCredentials } from "../../services/turnCredentials";
import { log } from "../../services/logger";
import { classifyConnectionQuality, isPolitePeer, type ConnectionQuality } from "./rtcPolicy";
import { decodeChatPayload, encodeChatPayload, normalizeChatText, MAX_CHAT_HISTORY, type ChatMessage } from "./chatProtocol";

const QUALITY_POLL_INTERVAL_MS = 3000;
/** Renovar a credencial TURN antes do `ttlSeconds` vencer (doc:
 * `docs/WEBRTC_TURN_PLAN.md`) — 80% da validade, nunca menos que 30s de
 * folga, pra sempre ter uma credencial de sobra pronta pra um peer novo. */
const TURN_REFRESH_SAFETY_MARGIN = 0.8;

type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Canal de chat (issue do usuário) — só o lado impolite cria
   * (`pc.createDataChannel`), o polite recebe via `pc.ondatachannel`; mesma
   * assimetria determinística de quem faz a offer, sem coordenação pela
   * rede (ver comentário em `ensurePeer`). `null` até a negociação
   * terminar OU se a conexão nunca chegou a abrir o canal. */
  dataChannel: RTCDataChannel | null;
};

export type GroupConnectionsState = {
  /** Stream remoto por uid — só entra aqui quando pelo menos uma track de
   * verdade chegou (nunca um placeholder). */
  remoteStreams: Map<string, MediaStream>;
  /** Quem tem uma track de vídeo real chegando agora (fonte de verdade:
   * `ontrack`, não só a mensagem `stream-started` — essa é só um aviso
   * pontual que quem entra depois de alguém já compartilhar nunca recebe).
   * Reflete "está compartilhando agora", não só "tem conexão aberta". */
  sharingPeers: Set<string>;
  peerQuality: Map<string, ConnectionQuality>;
  signalingStatus: "idle" | "connecting" | "connected" | "error";
  /** Histórico de chat da sala selecionada, mais recente por último —
   * nunca persistido, some ao trocar de grupo (ver cleanup do efeito de
   * conexão). */
  chatMessages: ChatMessage[];
};

const EMPTY_STATE: GroupConnectionsState = {
  remoteStreams: new Map(),
  sharingPeers: new Set(),
  peerQuality: new Map(),
  signalingStatus: "idle",
  chatMessages: [],
};

/** Extrai o RTT (ms) do par de candidato ICE selecionado — não existe um
 * jeito direto de perguntar "qual é o ping agora", só varrer `getStats()`
 * atrás do par com `state === "succeeded"` que está de fato carregando
 * tráfego. Retorna `null` quando ainda não há um par selecionado (conexão
 * nova) ou o navegador não expõe `currentRoundTripTime` nesse par. */
async function currentRttMs(pc: RTCPeerConnection): Promise<number | null> {
  try {
    const report = await pc.getStats();
    for (const stat of report.values()) {
      if (stat.type === "candidate-pair" && stat.state === "succeeded" && typeof stat.currentRoundTripTime === "number") {
        return stat.currentRoundTripTime * 1000;
      }
    }
  } catch {
    // getStats() nunca deveria derrubar a UI por falhar.
  }
  return null;
}

/**
 * Orquestra o lado cliente da issue #71: sinalização (`/ws`) + um
 * `RTCPeerConnection` por participante do grupo (malha completa, não SFU —
 * escala compatível com "grupos privados de amigos", mesma filosofia de
 * escala das decisões do backend em `docs/backend/ARQUITETURA.md`) +
 * credenciais TURN reais (#41). Perfect negotiation (evita "glare" sem
 * nenhuma coordenação pela rede — só compara os dois ids, `rtcPolicy.ts`)
 * pra não precisar de um líder/coordenador central.
 *
 * `localStream` (vídeo sempre, áudio do sistema quando ligado — vem de
 * `sharingState.ts`) é replicado pra TODO peer conectado: anexar/trocar
 * tracks nunca é responsabilidade de quem está vendo a tela, só de quem
 * está transmitindo.
 */
export function useGroupConnections(groupId: string | undefined, selfId: string, localStream: MediaStream | null): GroupConnectionsState & { sendChatMessage: (text: string) => void } {
  const [state, setState] = useState<GroupConnectionsState>(EMPTY_STATE);

  const peersRef = useRef(new Map<string, PeerState>());
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const signalingRef = useRef<SignalingHandle | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  localStreamRef.current = localStream;

  function publishState() {
    setState({
      remoteStreams: new Map(remoteStreamsRef.current),
      sharingPeers: new Set(sharingPeersRef.current),
      peerQuality: new Map(peerQualityRef.current),
      signalingStatus: signalingStatusRef.current,
      chatMessages: chatMessagesRef.current,
    });
  }

  const remoteStreamsRef = useRef(new Map<string, MediaStream>());
  const sharingPeersRef = useRef(new Set<string>());
  const peerQualityRef = useRef(new Map<string, ConnectionQuality>());
  const signalingStatusRef = useRef<GroupConnectionsState["signalingStatus"]>("idle");
  const chatMessagesRef = useRef<ChatMessage[]>([]);

  function appendChatMessage(message: ChatMessage) {
    chatMessagesRef.current = [...chatMessagesRef.current, message].slice(-MAX_CHAT_HISTORY);
    publishState();
  }

  /** Liga os handlers de um `RTCDataChannel` de chat — chamado tanto pro
   * lado que cria (`createDataChannel`) quanto pro que recebe
   * (`ondatachannel`), sempre com o `uid` real do peer autenticado (nunca
   * de um campo dentro da mensagem — mesma lição do bug corrigido em
   * `backend/src/signaling/plugin.ts`: identidade vem da conexão, não do
   * payload). */
  function wireDataChannel(uid: string, peer: PeerState, channel: RTCDataChannel) {
    peer.dataChannel = channel;
    channel.onmessage = event => {
      if (typeof event.data !== "string") return; // nunca aceita binario aqui
      const decoded = decodeChatPayload(event.data);
      if (!decoded) {
        log.debug("rtc", "mensagem de chat com formato invalido, ignorada", { uid });
        return;
      }
      appendChatMessage({ from: uid, text: decoded.text, at: decoded.at });
    };
    channel.onerror = () => {
      log.debug("rtc", "canal de chat com erro", { uid });
    };
  }

  function sendChatMessage(text: string) {
    const normalized = normalizeChatText(text);
    if (!normalized) return;
    const at = Date.now();
    appendChatMessage({ from: selfId, text: normalized, at });
    const payload = encodeChatPayload(normalized, at);
    for (const peer of peersRef.current.values()) {
      if (peer.dataChannel?.readyState !== "open") continue;
      try {
        peer.dataChannel.send(payload);
      } catch (error) {
        log.warn("rtc", "falha ao enviar mensagem de chat pra um peer", { name: error instanceof Error ? error.name : "unknown" });
      }
    }
  }

  function syncLocalTracks(pc: RTCPeerConnection) {
    // Uma conexao ja fechada (peer saiu, ICE falhou) nunca deveria receber
    // addTrack/removeTrack — isso lanca `InvalidStateError` de verdade e,
    // sem essa guarda, quebrava o loop inteiro em `peersRef.current.values()`
    // (achado real testando: uma conexao presa impedia TODO mundo de
    // receber a track nova, nao so o peer com problema).
    if (pc.connectionState === "closed") return;
    try {
      const stream = localStreamRef.current;
      const senders = pc.getSenders();
      const liveTrackIds = new Set((stream?.getTracks() ?? []).map(track => track.id));

      for (const sender of senders) {
        if (sender.track && !liveTrackIds.has(sender.track.id)) {
          pc.removeTrack(sender);
        }
      }
      if (stream) {
        const sentTrackIds = new Set(pc.getSenders().map(sender => sender.track?.id).filter(Boolean));
        for (const track of stream.getTracks()) {
          if (!sentTrackIds.has(track.id)) pc.addTrack(track, stream);
        }
      }
    } catch (error) {
      log.warn("rtc", "falha ao sincronizar tracks locais com um peer", { name: error instanceof Error ? error.name : "unknown" });
    }
  }

  function ensurePeer(uid: string): PeerState {
    const existing = peersRef.current.get(uid);
    // Uma conexao velha (fechada/falha) presa no mapa nunca deveria ser
    // reaproveitada — cria uma nova do zero, igual `peer-reconnected` ja
    // fazia explicitamente. `failed` tambem entra aqui: ICE que nunca
    // recupera sozinho, mesma logica de "esta morta, comeca de novo".
    if (existing && existing.pc.connectionState !== "closed" && existing.pc.connectionState !== "failed") return existing;
    if (existing) closePeer(uid);

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    const peer: PeerState = { pc, polite: isPolitePeer(selfId, uid), makingOffer: false, ignoreOffer: false, dataChannel: null };
    peersRef.current.set(uid, peer);

    // Chat (issue do usuário) — canal de dados na mesma conexão, criado só
    // por um dos dois lados (mesma assimetria determinística de quem faz a
    // offer): o outro lado sempre recebe via `ondatachannel`, nunca os dois
    // criam, senão viraria dois canais paralelos em vez de um só.
    if (!peer.polite) wireDataChannel(uid, peer, pc.createDataChannel("chat", { ordered: true }));
    pc.ondatachannel = event => {
      if (event.channel.label === "chat") wireDataChannel(uid, peer, event.channel);
    };

    pc.onicecandidate = event => {
      if (!event.candidate) return;
      signalingRef.current?.send({
        type: "ice-candidate",
        to: uid,
        payload: { candidate: event.candidate.candidate, sdpMid: event.candidate.sdpMid, sdpMLineIndex: event.candidate.sdpMLineIndex },
      });
    };

    pc.ontrack = event => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      remoteStreamsRef.current.set(uid, stream);
      // Fonte real de "esta compartilhando" e a track em si, nao so o aviso
      // `stream-started` — achado real testando com um segundo participante
      // entrando DEPOIS que o primeiro ja estava transmitindo: esse aviso e
      // um evento unico, quem entra depois nunca recebe (ja passou), entao
      // nunca via nada mesmo com a conexao WebRTC funcionando perfeitamente.
      if (event.track.kind === "video") {
        sharingPeersRef.current.add(uid);
        event.track.addEventListener("ended", () => {
          sharingPeersRef.current.delete(uid);
          publishState();
        });
      }
      publishState();
    };

    pc.onconnectionstatechange = () => {
      log.debug("rtc", "estado da conexao mudou", { uid, state: pc.connectionState });
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        peerQualityRef.current.delete(uid);
        publishState();
      }
    };

    // Perfect negotiation (W3C) — só o lado "impolite" cria a offer
    // automaticamente; o lado polite responde e, se receber uma offer
    // alheia enquanto também estava criando a sua, descarta a própria em
    // vez de colidir (ver handler de "offer" abaixo, `ignoreOffer`).
    pc.onnegotiationneeded = () => {
      void (async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          signalingRef.current?.send({ type: "offer", to: uid, payload: { sdp: pc.localDescription!.sdp } });
        } catch (error) {
          log.warn("rtc", "falha ao criar offer", { uid, name: error instanceof Error ? error.name : "unknown" });
        } finally {
          peer.makingOffer = false;
        }
      })();
    };

    syncLocalTracks(pc);
    return peer;
  }

  function closePeer(uid: string) {
    const peer = peersRef.current.get(uid);
    if (!peer) return;
    peer.pc.close();
    peersRef.current.delete(uid);
    remoteStreamsRef.current.delete(uid);
    sharingPeersRef.current.delete(uid);
    peerQualityRef.current.delete(uid);
  }

  async function handleServerEvent(event: ServerEvent) {
    switch (event.type) {
      case "joined": {
        signalingStatusRef.current = "connected";
        for (const uid of event.payload.members) {
          if (uid !== selfId) ensurePeer(uid);
        }
        publishState();
        break;
      }
      case "peer-joined": {
        ensurePeer(event.from);
        publishState();
        break;
      }
      case "peer-reconnected": {
        // Conexao antiga desse peer provavelmente ja caiu — fecha e
        // recomeca do zero em vez de tentar um ICE-restart sutil (mais
        // simples, e a renegociacao automatica (`onnegotiationneeded`) ja
        // reenvia as tracks locais que estiverem ativas nesse momento).
        closePeer(event.from);
        ensurePeer(event.from);
        publishState();
        break;
      }
      case "peer-left": {
        closePeer(event.from);
        publishState();
        break;
      }
      case "offer": {
        const peer = ensurePeer(event.from);
        const offerCollision = peer.makingOffer || peer.pc.signalingState !== "stable";
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) {
          log.debug("rtc", "offer ignorada (colisao, lado impolite)", { uid: event.from });
          break;
        }
        try {
          await peer.pc.setRemoteDescription({ type: "offer", sdp: event.payload.sdp });
          await peer.pc.setLocalDescription();
          signalingRef.current?.send({ type: "answer", to: event.from, payload: { sdp: peer.pc.localDescription!.sdp } });
        } catch (error) {
          log.warn("rtc", "falha ao processar offer", { uid: event.from, name: error instanceof Error ? error.name : "unknown" });
        }
        break;
      }
      case "answer": {
        const peer = peersRef.current.get(event.from);
        if (!peer) break;
        try {
          await peer.pc.setRemoteDescription({ type: "answer", sdp: event.payload.sdp });
        } catch (error) {
          log.warn("rtc", "falha ao processar answer", { uid: event.from, name: error instanceof Error ? error.name : "unknown" });
        }
        break;
      }
      case "ice-candidate": {
        const peer = peersRef.current.get(event.from);
        if (!peer) break;
        try {
          await peer.pc.addIceCandidate({
            candidate: event.payload.candidate,
            sdpMid: event.payload.sdpMid ?? undefined,
            sdpMLineIndex: event.payload.sdpMLineIndex ?? undefined,
          });
        } catch (error) {
          // Candidato tardio pra uma conexao que ja mudou de estado nao e
          // um erro real — so registra, nunca derruba a conexao por isso.
          log.debug("rtc", "falha ao adicionar ice-candidate (provavelmente tardio)", {
            uid: event.from,
            name: error instanceof Error ? error.name : "unknown",
          });
        }
        break;
      }
      case "stream-started": {
        sharingPeersRef.current.add(event.from);
        publishState();
        break;
      }
      case "stream-stopped": {
        sharingPeersRef.current.delete(event.from);
        publishState();
        break;
      }
      case "error": {
        log.warn("rtc", "sinalizacao reportou erro", { code: event.payload.code });
        if (event.payload.code === "unauthorized" || event.payload.code === "forbidden") {
          signalingStatusRef.current = "error";
          publishState();
        }
        break;
      }
    }
  }

  // Conecta/reconecta quando o grupo muda — nunca quando só o localStream
  // muda (isso e tratado no efeito de baixo, sem reabrir sinalizacao).
  useEffect(() => {
    if (!groupId) {
      signalingStatusRef.current = "idle";
      publishState();
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    signalingStatusRef.current = "connecting";
    publishState();

    function loadTurnCredentials() {
      fetchTurnCredentials()
        .then(credentials => {
          if (cancelled) return;
          iceServersRef.current = credentials.iceServers;
          // Peers ja conectados continuam com a config antiga ate a proxima
          // negociacao (ICE so troca de servidor num restart) — isto aqui
          // garante que um peer NOVO, criado depois da renovacao, ja nasce
          // com credencial valida em vez de uma perto de expirar.
          refreshTimer = setTimeout(loadTurnCredentials, credentials.ttlSeconds * 1000 * TURN_REFRESH_SAFETY_MARGIN);
        })
        .catch(error => {
          log.warn("rtc", "nao foi possivel obter credenciais TURN, seguindo so com STUN/host", {
            message: error instanceof Error ? error.message : "unknown",
          });
        });
    }
    loadTurnCredentials();

    const handle = connectSignaling(groupId, event => void handleServerEvent(event));
    signalingRef.current = handle;

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      handle.close();
      signalingRef.current = null;
      for (const uid of Array.from(peersRef.current.keys())) closePeer(uid);
      remoteStreamsRef.current = new Map();
      sharingPeersRef.current = new Set();
      peerQualityRef.current = new Map();
      // Chat e efemero por sala (pedido do usuario) — nunca sobrevive a
      // troca de grupo, igual a presenca/sinalizacao do backend.
      chatMessagesRef.current = [];
      signalingStatusRef.current = "idle";
      publishState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, selfId]);

  // Replica o stream local (ou a ausencia dele) em toda conexao aberta, e
  // avisa os outros participantes via stream-started/stream-stopped — sem
  // isso, quem entra depois de alguem ja estar compartilhando nunca
  // descobriria (a track so aparece quando a conexao e criada DEPOIS que
  // a track ja existia, ou quando `onnegotiationneeded` dispara de novo).
  useEffect(() => {
    for (const peer of peersRef.current.values()) syncLocalTracks(peer.pc);
    signalingRef.current?.send({ type: localStream ? "stream-started" : "stream-stopped", payload: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream]);

  // Poll periodico de qualidade (RTT) — só entre conexões abertas.
  useEffect(() => {
    const interval = setInterval(() => {
      void (async () => {
        let changed = false;
        for (const [uid, peer] of peersRef.current) {
          if (peer.pc.connectionState !== "connected") continue;
          const rtt = await currentRttMs(peer.pc);
          const quality = classifyConnectionQuality(rtt);
          if (peerQualityRef.current.get(uid) !== quality) {
            peerQualityRef.current.set(uid, quality);
            changed = true;
          }
        }
        if (changed) publishState();
      })();
    }, QUALITY_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return { ...state, sendChatMessage };
}
