"use client";

import { useState } from "react";
import { assetUrl, evidenceLabels } from "./types";
import { NoEvidence } from "./WorkspaceStates";
import styles from "./projectVisual.module.css";

export function VisualImage({ src, alt, className = "" }: { src: string | null; alt: string; className?: string }) {
  const safe = assetUrl(src) || "/images/pool_art_director.png";
  const [expanded,setExpanded]=useState(false);
  return <><button type="button" className={styles.imageZoomButton} onClick={()=>setExpanded(true)} aria-label={`${alt} 확대 보기`} style={{ position: "relative", display: "block", width: "100%", overflow: "hidden" }}><img className={className} src={safe} alt={alt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />{!src && <span style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.7)", color: "#F59E0B", fontSize: "11px", fontWeight: 900, padding: "2px 6px", borderRadius: "4px" }}>⚠️ 데모 시각화</span>}</button>{expanded&&<div className={styles.imageLightbox} role="dialog" aria-modal="true" aria-label={`${alt} 확대 이미지`}><button onClick={()=>setExpanded(false)} aria-label="확대 이미지 닫기">닫기 ×</button><img src={safe} alt={alt}/></div>}</>;
}

export function CollapsibleText({ children }: { children: React.ReactNode }) { return <details className={styles.collapsibleText}><summary>내용 보기</summary><div>{children}</div></details>; }

export function Evidence({ values }: { values: unknown[] }) {
  const labels = evidenceLabels(values);
  return labels.length ? <div className={styles.evidenceList}>{labels.map(label=><code key={label}>{label}</code>)}</div> : <NoEvidence />;
}

export function ViewHeading({ index, title, description }: { index: string; title: string; description: string }) {
  return <div className={styles.viewHeading}><div><span>{index}</span><h2>{title}</h2></div><p>{description}</p></div>;
}

export function IdTag({ children }: { children: React.ReactNode }) { return <code className={styles.idTag}>{children}</code>; }
