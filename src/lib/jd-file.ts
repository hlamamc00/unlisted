import "server-only";
import mammoth from "mammoth";

/** Text of an uploaded job description: PDF, Word (.docx) or plain text. */
export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    return text;
  }
  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  }
  if (name.endsWith(".doc")) {
    throw new Error("Older .doc files can't be read. Save it as .docx or PDF, or paste the text.");
  }
  return new TextDecoder().decode(bytes);
}
