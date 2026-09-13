import { NextResponse } from "next/server";
import { ImageGenError, httpStatusFor } from "@/lib/images/errors";
import { ADOPTIONS, ADOPTION_LABEL, createReference, listReferences, type Adoption } from "@/lib/images/references";

export const runtime = "nodejs";

/** GET — 회의 레퍼런스 목록. 반영 수준은 4단계 라벨로 함께 준다(퍼센트 없음). */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = await props.params;
  const references = listReferences(meetingId).map((r) => ({ ...r, adoptionLabel: ADOPTION_LABEL[r.adoption] }));
  return NextResponse.json({ references });
}

/** take·avoid·evidence: 같은 이름을 여러 번 보내거나, JSON 배열 문자열, 또는 줄바꿈·쉼표로 나눈 문자열. */
function listField(form: FormData, name: string): string[] {
  const out: string[] = [];
  for (const v of form.getAll(name)) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    if (s.startsWith("[")) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) {
          out.push(...arr.map((x) => String(x).trim()).filter(Boolean));
          continue;
        }
      } catch {
        // JSON 이 아니면 아래에서 나눈다
      }
    }
    out.push(...s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean));
  }
  return out;
}

/**
 * POST multipart — 팀이 올린 레퍼런스 이미지.
 * 필드: file, title, source, adoption(core|partial|reference|excluded), take, avoid, uploadedBy?, evidence?
 * 외부 URL 을 받아 대신 내려받지 않는다. 파일은 .data/references/ 에 둔다.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = await props.params;
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return NextResponse.json({ code: "INVALID_INPUT", error: "multipart/form-data 로 보내야 합니다." }, { status: 400 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json({ code: "INVALID_INPUT", error: `업로드를 읽지 못했습니다: ${(e as Error).message}` }, { status: 400 });
  }
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const adoption = str("adoption") || "reference";
  if (!(ADOPTIONS as readonly string[]).includes(adoption)) {
    return NextResponse.json(
      { code: "INVALID_INPUT", error: `adoption 은 ${ADOPTIONS.join(" | ")} 중 하나여야 합니다.` },
      { status: 400 },
    );
  }
  const file = form.get("file");
  try {
    const { reference, warnings } = await createReference({
      meetingId,
      title: str("title"),
      source: str("source"),
      uploadedBy: str("uploadedBy") || null,
      adoption: adoption as Adoption,
      take: listField(form, "take"),
      avoid: listField(form, "avoid"),
      evidence: listField(form, "evidence"),
      file: file instanceof File && file.size > 0 ? { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name } : null,
    });
    return NextResponse.json(
      { reference: { ...reference, adoptionLabel: ADOPTION_LABEL[reference.adoption] }, warnings },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ImageGenError) {
      return NextResponse.json({ code: e.code, error: e.message, detail: e.detail }, { status: httpStatusFor(e.code) });
    }
    return NextResponse.json({ code: "PROVIDER_ERROR", error: (e as Error).message }, { status: 500 });
  }
}
