import type { WorkspaceReadModelRepository,ProjectVisualWorkspaceReadModel } from "../../repositories/projectVisual";
import { ProjectVisualServiceError } from "./errors";
import { id } from "./validation";
export class ProjectVisualReadModelService{
  constructor(private readonly readModel:Pick<WorkspaceReadModelRepository,"get">){}
  async getProjectVisualWorkspace(projectId:string):Promise<ProjectVisualWorkspaceReadModel>{const result=await this.readModel.get(id(projectId,"projectId"));if(!result)throw new ProjectVisualServiceError("NOT_FOUND","Project was not found");return result;}
}
