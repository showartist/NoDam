import { ApprovalRepository,CharacterVisualRepository,createProjectVisualDatabase,DecisionLineageRepository,DecisionQuestionRepository,PrincipleRepository,ReferenceRepository,WorkspaceReadModelRepository } from "../../repositories/projectVisual";
import { ProjectVisualServiceError } from "./errors";
import { ProjectVisualService } from "./projectVisualService";
let service:ProjectVisualService|null=null;
export function getProjectVisualService():ProjectVisualService{
  if(service)return service;
  const url = process.env.DATABASE_URL;
  if (!url) throw new ProjectVisualServiceError("DATABASE_NOT_CONFIGURED", "Project Visual persistence is not configured");
  const db=createProjectVisualDatabase(url);
  service=new ProjectVisualService({readModel:new WorkspaceReadModelRepository(db),references:new ReferenceRepository(db),questions:new DecisionQuestionRepository(db),principles:new PrincipleRepository(db),approvals:new ApprovalRepository(db),characters:new CharacterVisualRepository(db),lineage:new DecisionLineageRepository(db)});
  return service;
}
