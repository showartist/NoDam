import fs from "fs";
import path from "path";

export type EvaluationMetrics = {
  expectedIssuesCount: number;
  predictedIssuesCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  evidencePrecision: number;
  evidenceRecall: number;
  evidenceF1: number;
  falseEscalationCount: number;
  falseEscalationRate: number;
};

export function evaluatePrediction(goldPath: string, predPath: string): EvaluationMetrics {
  const gold = JSON.parse(fs.readFileSync(goldPath, "utf-8"));
  const pred = JSON.parse(fs.readFileSync(predPath, "utf-8"));

  const expectedIssues = gold.expected_issues || [];
  const expectedNonIssues = gold.expected_non_issues || [];
  const predictedIssues = pred.issues || [];

  const expectedMap = new Map<string, any>();
  expectedIssues.forEach((i: any) => expectedMap.set(i.subject_key, i));

  const nonIssueKeys = new Set<string>(expectedNonIssues.map((ni: any) => ni.subject_key));

  let tp = 0;
  let fp = 0;
  let falseEscalations = 0;

  let totalEvidenceIntersections = 0;
  let totalPredictedEvidence = 0;
  let totalExpectedEvidence = 0;

  predictedIssues.forEach((pIssue: any) => {
    const key = pIssue.subject_key;
    const pEvidence = new Set<string>(pIssue.evidence || []);
    totalPredictedEvidence += pEvidence.size;

    if (expectedMap.has(key)) {
      tp++;
      const gIssue = expectedMap.get(key);
      const gEvidence = new Set<string>(gIssue.evidence || []);
      totalExpectedEvidence += gEvidence.size;

      // Evidence 오버랩 계산
      let intersection = 0;
      pEvidence.forEach((e) => {
        if (gEvidence.has(e)) intersection++;
      });
      totalEvidenceIntersections += intersection;
    } else {
      fp++;
      // Non-issue를 open 이슈로 잘못 승격했는지 검사 (False Escalation)
      if (nonIssueKeys.has(key)) {
        falseEscalations++;
      }
    }
  });

  const fn = Math.max(0, expectedIssues.length - tp);

  const precision = predictedIssues.length > 0 ? tp / predictedIssues.length : 0;
  const recall = expectedIssues.length > 0 ? tp / expectedIssues.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const evPrecision = totalPredictedEvidence > 0 ? totalEvidenceIntersections / totalPredictedEvidence : 0;
  const evRecall = totalExpectedEvidence > 0 ? totalEvidenceIntersections / totalExpectedEvidence : 0;
  const evF1 = evPrecision + evRecall > 0 ? (2 * evPrecision * evRecall) / (evPrecision + evRecall) : 0;

  const falseEscalationRate = expectedNonIssues.length > 0 ? falseEscalations / expectedNonIssues.length : 0;

  return {
    expectedIssuesCount: expectedIssues.length,
    predictedIssuesCount: predictedIssues.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    evidencePrecision: evPrecision,
    evidenceRecall: evRecall,
    evidenceF1: evF1,
    falseEscalationCount: falseEscalations,
    falseEscalationRate,
  };
}

// CLI 실행 처리
if (require.main === module) {
  const args = process.argv.slice(2);
  const goldIdx = args.indexOf("--gold");
  const predIdx = args.indexOf("--prediction");

  const defaultGold = path.join(process.cwd(), "fixtures/gold/scene12_implicit.gold.json");
  const defaultPred = path.join(process.cwd(), "outputs/scene12_implicit.prediction.json");

  const goldPath = goldIdx !== -1 ? args[goldIdx + 1] : defaultGold;
  const predPath = predIdx !== -1 ? args[predIdx + 1] : defaultPred;

  console.log(`\n🔍 Evaluating Prediction against Gold Label...`);
  console.log(`• Gold: ${goldPath}`);
  console.log(`• Prediction: ${predPath}\n`);

  if (!fs.existsSync(goldPath) || !fs.existsSync(predPath)) {
    console.error(`❌ File not found! Check paths.`);
    process.exit(1);
  }

  const res = evaluatePrediction(goldPath, predPath);

  console.log(`=======================================================`);
  console.log(`📊 SceneSync Evaluation Metrics Report`);
  console.log(`=======================================================`);
  console.log(`Expected Issues        : ${res.expectedIssuesCount}`);
  console.log(`Predicted Issues       : ${res.predictedIssuesCount}`);
  console.log(`True Positives (TP)    : ${res.truePositives}`);
  console.log(`False Positives (FP)   : ${res.falsePositives}`);
  console.log(`False Negatives (FN)   : ${res.falseNegatives}`);
  console.log(`-------------------------------------------------------`);
  console.log(`Precision              : ${res.precision.toFixed(3)}`);
  console.log(`Recall                 : ${res.recall.toFixed(3)}`);
  console.log(`F1 Score               : ${res.f1.toFixed(3)}`);
  console.log(`-------------------------------------------------------`);
  console.log(`Evidence Precision     : ${res.evidencePrecision.toFixed(3)}`);
  console.log(`Evidence Recall        : ${res.evidenceRecall.toFixed(3)}`);
  console.log(`Evidence F1 Score      : ${res.evidenceF1.toFixed(3)}`);
  console.log(`-------------------------------------------------------`);
  console.log(`False Escalation Count : ${res.falseEscalationCount}`);
  console.log(`False Escalation Rate  : ${(res.falseEscalationRate * 100).toFixed(1)}%`);
  console.log(`=======================================================\n`);
}
