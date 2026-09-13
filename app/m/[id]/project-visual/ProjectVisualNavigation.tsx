import { VIEW_ITEMS, type ViewId } from "./types";
import styles from "./projectVisual.module.css";

export default function ProjectVisualNavigation({ active, onChange }: { active: ViewId; onChange: (view: ViewId) => void }) {
  return <nav className={styles.workspaceNav} aria-label="Project Visual 서브뷰">{VIEW_ITEMS.map((item,index)=><button key={item.id} className={active===item.id?styles.activeNav:""} aria-current={active===item.id?"page":undefined} onClick={()=>onChange(item.id)}><small>0{index+1}</small><span>{item.label}</span></button>)}</nav>;
}
