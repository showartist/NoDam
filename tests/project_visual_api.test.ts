import assert from "node:assert/strict";
import test from "node:test";
import { fail } from "../app/api/project-visual/http";
import { GET as getWorkspace } from "../app/api/project-visual/projects/[projectId]/workspace/route";
import { ProjectVisualServiceError } from "../lib/services/projectVisual";

test("database_not_configured_returns_explicit_error",async()=>{const previous=process.env.DATABASE_URL;delete process.env.DATABASE_URL;try{const response=await getWorkspace(new Request("http://localhost/api/project-visual/projects/project-1/workspace"),{params:Promise.resolve({projectId:"project-1"})});const body:any=await response.json();assert.equal(response.status,503);assert.equal(body.error.code,"DATABASE_NOT_CONFIGURED");}finally{if(previous)process.env.DATABASE_URL=previous;}});
test("api_never_exposes_database_url",async()=>{const response=fail(new ProjectVisualServiceError("INTERNAL_ERROR","Safe failure",{databaseUrl:"postgresql://user:secret@example/db",sql:"SELECT secret"}));const raw=await response.text();assert.equal(raw.includes("postgresql://"),false);assert.equal(raw.includes("SELECT secret"),false);assert.equal(raw.includes("stack"),false);});
test("api_never_falls_back_to_sqlite",async()=>{const previous=process.env.DATABASE_URL;delete process.env.DATABASE_URL;try{const response=await getWorkspace(new Request("http://localhost/api/project-visual/projects/project-1/workspace"),{params:Promise.resolve({projectId:"project-1"})});const raw=await response.text();assert.equal(response.status,503);assert.match(raw,/DATABASE_NOT_CONFIGURED/);assert.equal(raw.toLowerCase().includes("sqlite"),false);}finally{if(previous)process.env.DATABASE_URL=previous;}});
