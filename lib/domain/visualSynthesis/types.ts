export type SpeakerRole = "director" | "cinematographer" | "production_designer" | "producer" | "writer" | "unknown";

export type ImageTier = "exploration" | "production_candidate";

export interface SpeakerOpinion {
  speakerRole: SpeakerRole;
  speakerName: string;
  groundingUids: string[];
  rawUtterances: string[];
  summary: string;
}

export interface VisualParameters {
  emotionAndTone?: string;
  shotSizeAndLens?: string;
  textureAndColor?: string;
  lightingAndFeasibilityConstraints?: string;
}

export interface ExplorationImage {
  id: string;
  tier: "exploration";
  speakerRole: SpeakerRole;
  groundingUids: string[];
  derivedPrompt: string;
  imageUri: string;
  visualParameters: VisualParameters;
  canBeTaken: false;
  createdAt: string;
}

export interface SelectedElement {
  sourceImageId: string;
  sourceSpeakerRole: SpeakerRole;
  category: keyof VisualParameters;
  selectedText: string;
}

export interface IntegratedRecipe {
  id: string;
  sceneNumber: number;
  shotNumber?: number;
  selectedElements: SelectedElement[];
  compiledPrompt: string;
  createdAt: string;
}

export interface ProductionCandidateImage {
  id: string;
  tier: "production_candidate";
  integratedRecipeId: string;
  candidateNumber: number;
  derivedPrompt: string;
  imageUri: string;
  status: "pending" | "take" | "drop";
  canBeTaken: true;
  createdAt: string;
}

export type TwoTierImage = ExplorationImage | ProductionCandidateImage;
