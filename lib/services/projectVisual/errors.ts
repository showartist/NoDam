export type ProjectVisualErrorCode="DATABASE_NOT_CONFIGURED"|"NOT_FOUND"|"VALIDATION_ERROR"|"APPROVAL_INCOMPLETE"|"INVALID_STATE_TRANSITION"|"CASCADE_CONTRACT_VIOLATION"|"CONFLICT"|"INTERNAL_ERROR";
const STATUS:Record<ProjectVisualErrorCode,number>={DATABASE_NOT_CONFIGURED:503,NOT_FOUND:404,VALIDATION_ERROR:400,APPROVAL_INCOMPLETE:409,INVALID_STATE_TRANSITION:409,CASCADE_CONTRACT_VIOLATION:409,CONFLICT:409,INTERNAL_ERROR:500};
export class ProjectVisualServiceError extends Error{
  readonly status:number;
  constructor(readonly code:ProjectVisualErrorCode,message:string,readonly details?:unknown){super(message);this.name="ProjectVisualServiceError";this.status=STATUS[code];}
}
export function toProjectVisualError(error:unknown):ProjectVisualServiceError{
  if(error instanceof ProjectVisualServiceError)return error;
  const candidate=error as {code?:string;constraint?:string;message?:string};
  if(candidate.code==="23505")return new ProjectVisualServiceError("CONFLICT","The requested Project Visual record already exists");
  if(candidate.code==="23514"||candidate.constraint==="cascade_impacts_check")return new ProjectVisualServiceError("CASCADE_CONTRACT_VIOLATION","The cascade result violates the approved domain contract");
  if(candidate.code==="23503")return new ProjectVisualServiceError("NOT_FOUND","A referenced Project Visual record was not found");
  if(candidate.message?.includes("DATABASE_URL"))return new ProjectVisualServiceError("DATABASE_NOT_CONFIGURED","Project Visual persistence is not configured");
  return new ProjectVisualServiceError("INTERNAL_ERROR","Project Visual request could not be completed");
}
