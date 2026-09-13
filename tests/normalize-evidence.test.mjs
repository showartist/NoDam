// normalizeEvidence 단위 테스트 — 실제 구현을 직접 import 해서 검증한다.
// 실행: node --experimental-strip-types tests/normalize-evidence.test.mjs
import assert from "node:assert/strict";
import { normalizeEvidence, setEvidenceWarningHandler } from "../lib/normalize.ts";

let checks = 0;
const warnings = [];
setEvidenceWarningHandler((w) => warnings.push(w));

const ctx = { meetingId: "m_test", recordId: "R-01", field: "evidence" };
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};

warnings.length = 0;
eq(normalizeEvidence(["U01", "U03"], ctx), ["U01", "U03"], "배열");
assert.equal(warnings.length, 0, "정상 배열은 경고 없음");

warnings.length = 0;
eq(normalizeEvidence('["U01","U03"]', ctx), ["U01", "U03"], "JSON 배열 문자열");
assert.equal(warnings.length, 0, "JSON 배열 문자열은 경고 없음");

warnings.length = 0;
eq(normalizeEvidence("U01", ctx), ["U01"], "단일 U-ID 문자열");
assert.equal(warnings.length, 0, "단일 U-ID는 경고 없음");

warnings.length = 0;
eq(normalizeEvidence(null, ctx), [], "null");
assert.equal(warnings.length, 0, "null 은 정상 빈 상태 — 경고 없음");

warnings.length = 0;
eq(normalizeEvidence(undefined, ctx), [], "undefined");
assert.equal(warnings.length, 0, "undefined 는 정상 빈 상태 — 경고 없음");

warnings.length = 0;
eq(normalizeEvidence("", ctx), [], "빈 문자열");
assert.equal(warnings.length, 0, "빈 문자열은 정상 빈 상태 — 경고 없음");

warnings.length = 0;
eq(normalizeEvidence("{broken", ctx), [], "malformed JSON");
assert.equal(warnings.length, 1, "malformed JSON 은 경고 1건");
assert.equal(warnings[0].reason, "malformed_json");

warnings.length = 0;
eq(normalizeEvidence(42, ctx), [], "숫자");
assert.equal(warnings.length, 1, "숫자는 경고 1건");
assert.equal(warnings[0].reason, "not_an_array");

warnings.length = 0;
eq(normalizeEvidence({ foo: 1 }, ctx), [], "객체");
assert.equal(warnings.length, 1, "객체는 경고 1건");
assert.equal(warnings[0].reason, "not_an_array");

warnings.length = 0;
eq(normalizeEvidence('{"foo":1}', ctx), [], "객체로 파싱되는 JSON 문자열");
assert.equal(warnings.length, 1, "객체 파싱 결과는 경고 1건");
assert.equal(warnings[0].reason, "not_an_array");

warnings.length = 0;
eq(normalizeEvidence(["U01", "U01", "U03"], ctx), ["U01", "U03"], "중복 U-ID 제거");
assert.equal(warnings.length, 0, "중복은 정상 상태 — 경고 없음");

warnings.length = 0;
eq(normalizeEvidence(["U01", "X99", "u02", "U1"], ctx), ["U01"], "존재하지 않는 U-ID 형식 필터링");
assert.equal(warnings.length, 3, "형식 불일치 3건 각각 경고");
for (const w of warnings) assert.equal(w.reason, "invalid_uid_format");

warnings.length = 0;
eq(normalizeEvidence(["U01", 42, null, "U03"], ctx), ["U01", "U03"], "배열 안 비문자열 항목 무시");
assert.equal(warnings.length, 2, "비문자열 항목마다 경고");

warnings.length = 0;
eq(normalizeEvidence("  U05  ", ctx), ["U05"], "앞뒤 공백 있는 단일 U-ID");
assert.equal(warnings.length, 0);

warnings.length = 0;
const r = normalizeEvidence("not-json-not-uid", ctx);
eq(r, [], "U-ID 도 JSON 도 아닌 임의 문자열");
assert.equal(warnings.length, 1);
assert.equal(warnings[0].reason, "malformed_json");

// 경고에 추적 정보(meeting/record/field)가 실제로 담기는지
warnings.length = 0;
normalizeEvidence("{x", { meetingId: "m_07", recordId: "S-03", field: "shots.evidence" });
assert.equal(warnings[0].meetingId, "m_07");
assert.equal(warnings[0].recordId, "S-03");
assert.equal(warnings[0].field, "shots.evidence");
checks++;

console.log(`normalizeEvidence 단위 테스트 통과 — ${checks}개 항목`);
