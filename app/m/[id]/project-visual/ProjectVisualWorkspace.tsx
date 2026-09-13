"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchProjectVisualWorkspace, WorkspaceRequestError } from "./apiClient";
import CharacterBibleView from "./CharacterBibleView";
import ChangeImpactView from "./ChangeImpactView";
import PrincipleReviewView from "./PrincipleReviewView";
import PlanningActionDock from "./PlanningActionDock";
import ProjectVisualHeader from "./ProjectVisualHeader";
import ProjectVisualNavigation from "./ProjectVisualNavigation";
import ProjectVisualQuickSummary from "./ProjectVisualQuickSummary";
import ReferencesView from "./ReferencesView";
import RoleComparisonView from "./RoleComparisonView";
import type { ProjectVisualWorkspaceModel, ViewId, WorkspaceApiError } from "./types";
import VisualSpineView from "./VisualSpineView";
import { WorkspaceEmpty, WorkspaceError, WorkspaceLoading } from "./WorkspaceStates";
import { WriteProvider } from "./WriteContext";
import styles from "./projectVisual.module.css";

export default function ProjectVisualWorkspace({ projectId }: { projectId: string }) {
  const [model,setModel]=useState<ProjectVisualWorkspaceModel|null>(null);
  const [error,setError]=useState<WorkspaceApiError|null>(null);
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState<ViewId>("spine");
  const [attempt,setAttempt]=useState(0);
  const load=useCallback(()=>setAttempt(value=>value+1),[]);

  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true); setError(null);
    fetchProjectVisualWorkspace(projectId,controller.signal).then(data=>{setModel(data);setLoading(false);}).catch((reason:unknown)=>{
      if(controller.signal.aborted)return;
      setModel(null); setLoading(false);
      setError(reason instanceof WorkspaceRequestError?reason.payload:{code:"INTERNAL_ERROR",message:"Project Visual Workspace를 불러오지 못했습니다."});
    });
    return()=>controller.abort();
  },[projectId,attempt]);

  // 쓰기 성공 후 서버에서 다시 읽는다. UI 가 결과를 지어내지 않는다.
  // 전체 로딩 화면으로 되돌리지 않고 조용히 갱신한다.
  const reload=useCallback(async()=>{
    const fresh=await fetchProjectVisualWorkspace(projectId);
    setModel(fresh);
  },[projectId]);

  if(loading)return <div className={styles.workspaceShell}><WorkspaceLoading/></div>;
  if(error)return <div className={styles.workspaceShell}><WorkspaceError code={error.code} message={error.message} onRetry={load}/></div>;
  if(!model)return null;
  const empty=!model.references.length&&!model.principles.length&&!model.decisionQuestions.length&&!model.characterVisuals.length&&!model.cascadeImpacts.length;
  return <WriteProvider value={{projectId,participants:model.participants??[],reload}}>
    <section className={styles.workspaceShell} data-testid="project-visual-workspace" data-project-id={model.project.id}>
    <ProjectVisualHeader model={model} view={view}/><ProjectVisualQuickSummary model={model}/><ProjectVisualNavigation active={view} onChange={setView}/>
    <main className={styles.workspaceMain}>{empty?<WorkspaceEmpty/>:<>{view==="spine"&&<VisualSpineView model={model}/>} {view==="references"&&<ReferencesView model={model}/>} {view==="comparison"&&<RoleComparisonView model={model}/>} {view==="principles"&&<PrincipleReviewView model={model}/>} {view==="characters"&&<CharacterBibleView model={model}/>} {view==="impact"&&<ChangeImpactView model={model}/>}</>}</main>
    <PlanningActionDock/>
    <footer className={styles.readOnlyFooter}><span>Neon Workspace API · 쓰기 연결됨</span><span>Shot Recipe·생성 패키지는 이후 단계</span></footer>
  </section>
  </WriteProvider>;
}
