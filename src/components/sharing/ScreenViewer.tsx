import { useEffect, useRef } from "react";
import type { User } from "../../data/types";
import { Avatar } from "../ui/Avatar";
import { IconMinimize } from "../ui/Icons";
export function ScreenViewer({ user, members = [], stream, onMinimize, onSelect }: { user: User; members?: User[]; stream?: MediaStream; onMinimize: () => void; onSelect?: (user: User) => void }) {
 const video = useRef<HTMLVideoElement>(null);
 useEffect(() => { const element = video.current; if (element) element.srcObject = stream ?? null; return () => { if (element) element.srcObject = null; }; }, [stream]);
 return <section className="screen-viewer" aria-label={'tela de ' + user.name}><div className="stream-stage">
 {stream ? <video ref={video} autoPlay playsInline muted /> : <div className="stream-placeholder" />}
 <span className="viewer-label">{user.name}</span><button className="viewer-minimize nav-button" title="minimizar" onClick={onMinimize}><IconMinimize /></button>
 </div><aside className="viewer-members">{members.map(member => <button key={member.id} title={member.name} className={'viewer-member ' + (member.current ? 'is-current' : '')} onClick={() => onSelect?.(member)}><Avatar user={member} size="sm" /><span>{member.name}</span></button>)}</aside></section>;
}