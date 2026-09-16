import { z } from "zod";

/**
 * Protocolo de sinalização WebRTC (issue #38) — versionado e validado por
 * schema. Nunca inclui SDP/ICE nos logs (ver src/signaling/room.ts) e não
 * tem nenhum evento de áudio/microfone (o produto não tem voz).
 *
 * Envelope comum a todo evento: versão, tipo, correlationId, grupo, e
 * remetente/destinatário quando aplicável. `from` é sempre preenchido pelo
 * servidor a partir da identidade autenticada da conexão — nunca confiar
 * no que o cliente declarar.
 */

export const SIGNALING_PROTOCOL_VERSION = 1 as const;

const baseEnvelope = z.object({
  v: z.literal(SIGNALING_PROTOCOL_VERSION),
  correlationId: z.string().min(1).max(100),
});

const offerSchema = baseEnvelope.extend({
  type: z.literal("offer"),
  to: z.string().min(1),
  payload: z.object({ sdp: z.string().min(1) }),
});

const answerSchema = baseEnvelope.extend({
  type: z.literal("answer"),
  to: z.string().min(1),
  payload: z.object({ sdp: z.string().min(1) }),
});

const iceCandidateSchema = baseEnvelope.extend({
  type: z.literal("ice-candidate"),
  to: z.string().min(1),
  payload: z.object({
    candidate: z.string().min(1),
    sdpMid: z.string().nullish(),
    sdpMLineIndex: z.number().int().nullish(),
  }),
});

const streamStartedSchema = baseEnvelope.extend({
  type: z.literal("stream-started"),
  payload: z.object({}).default({}),
});

const streamStoppedSchema = baseEnvelope.extend({
  type: z.literal("stream-stopped"),
  payload: z.object({}).default({}),
});

/** Mensagens que o CLIENTE pode enviar. join/leave/erro são só do servidor → cliente. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  offerSchema,
  answerSchema,
  iceCandidateSchema,
  streamStartedSchema,
  streamStoppedSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface ServerEnvelope {
  v: typeof SIGNALING_PROTOCOL_VERSION;
  correlationId: string;
  groupId: string;
  from?: string;
  to?: string;
  /**
   * `peer-reconnected` (issue #42) — igual a `peer-joined` (`from` é quem
   * voltou), mas sinaliza que esse `uid` já estava na sala e a conexão foi
   * substituída (queda de rede curta, não um participante novo). É o
   * sinal pro cliente saber que provavelmente precisa de um ICE restart
   * com esse peer em vez de tratar como uma entrada do zero.
   */
  type:
    | "joined"
    | "peer-joined"
    | "peer-reconnected"
    | "peer-left"
    | "offer"
    | "answer"
    | "ice-candidate"
    | "stream-started"
    | "stream-stopped"
    | "error";
  payload: unknown;
}

/** Campos de evento que carregam SDP/ICE — nunca logar `payload` para estes. */
export const SENSITIVE_EVENT_TYPES = new Set(["offer", "answer", "ice-candidate"]);

export function parseClientMessage(raw: unknown): ClientMessage {
  return clientMessageSchema.parse(raw);
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}
