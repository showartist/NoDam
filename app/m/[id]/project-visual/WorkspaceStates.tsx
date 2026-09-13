import styles from "./projectVisual.module.css";

export function WorkspaceLoading() {
  return <section className={styles.statePanel} aria-busy="true" data-testid="workspace-loading"><div className={styles.skeletonHero} /><div className={styles.skeletonGrid}>{[0,1,2].map(i=><span key={i} />)}</div><strong>Project Visual Workspace 불러오는 중</strong></section>;
}

export function WorkspaceEmpty() {
  return <section className={styles.statePanel} data-testid="workspace-empty"><span className={styles.stateIcon}>◇</span><h2>아직 Project Visual 데이터가 없습니다</h2><p>Reference와 결정 질문을 등록하면 Visual Spine부터 제작 합의를 쌓을 수 있습니다.</p><button disabled>Phase 7에서 등록 활성화</button></section>;
}

export function WorkspaceError({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
  const database = code === "DATABASE_NOT_CONFIGURED";
  return <section className={`${styles.statePanel} ${styles.errorPanel}`} role="alert" data-testid={database ? "workspace-database-not-configured" : "workspace-error"}><span className={styles.stateIcon}>{database ? "⌁" : "!"}</span><h2>{database ? "영속 DB 연결이 필요합니다" : "Workspace를 불러오지 못했습니다"}</h2><code>{code}</code><p>{message}</p><p>{database ? "개발 환경의 DATABASE_URL을 연결해야 합니다. SQLite나 fixture로 대체하지 않습니다." : "잠시 후 다시 시도하십시오."}</p><button onClick={onRetry}>다시 시도</button></section>;
}

export function NoEvidence() { return <span className={styles.noEvidence} data-testid="no-evidence">근거 자료 없음 · 연출부 확인 필요</span>; }
export function MissingRole({ role }: { role: string }) { return <div className={styles.missingRole} data-testid="missing-role"><strong>{role}</strong><span>역할 의견 입력 없음</span></div>; }
export function LegacyUnknown() { return <span className={styles.legacyUnknown} data-testid="legacy-unknown">? 연결 정보 확인 필요 · 사람이 검토해야 함</span>; }
export function ReadOnlyAction({ blocked = false, children }: { blocked?: boolean; children: React.ReactNode }) { return <button className={blocked ? styles.blockedAction : styles.readOnlyAction} disabled aria-disabled="true">{blocked ? "승인 차단 · " : ""}{children}<small>Phase 7에서 활성화</small></button>; }
