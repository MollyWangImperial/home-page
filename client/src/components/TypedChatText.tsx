import { useEffect, useRef, useState, type ReactNode } from "react";
import { presentAliraMessage } from "@/lib/alira-message-style";
import "./typed-chat-text.css";

export function TypedChatText({ text, onComplete, onProgress, children }: {
  text: string;
  onComplete?: () => void;
  onProgress?: () => void;
  children?: (visible: string) => ReactNode;
}) {
  const [visible, setVisible] = useState("");
  const [thinking, setThinking] = useState(true);
  const complete = useRef(onComplete);
  const progress = useRef(onProgress);
  complete.current = onComplete;
  progress.current = onProgress;
  useEffect(() => {
    setVisible("");
    const controller = new AbortController();
    void presentAliraMessage(text, { onThinking: setThinking, onMessage: () => {}, onFrame: setVisible }, controller.signal)
      .then(() => complete.current?.()).catch(() => { /* Closing the chat cancels delivery. */ });
    return () => controller.abort("page-left");
  }, [text]);
  useEffect(() => { progress.current?.(); }, [visible]);
  // Announce the finished message once, rather than every character, to screen readers.
  return <>{thinking ? <span className="chat-thinking" role="status"><span className="chat-thinking-dots" aria-hidden="true"><i /><i /><i /></span>Alira is typing</span> : children ? <div aria-hidden="true">{children(visible)}</div> : <span aria-hidden="true">{visible || "\u00a0"}</span>}<span className="chat-sr">{visible === text ? text : ""}</span></>;
}
