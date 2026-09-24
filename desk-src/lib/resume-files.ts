import { type ResumeProfile, sections, profileLabels } from "./model";
export async function extractResume(file: File) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Choose a file smaller than 5 MB.");
  const buffer = await file.arrayBuffer();
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 30)
        throw new Error("Resumes must have 30 pages or fewer.");
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let prevY: number | null = null;
        for (const item of content.items) {
          if ("str" in item) {
            const y = item.transform[5];
            if (prevY !== null && Math.abs(y - prevY) > 3) text += "\n";
            text += item.str + (item.hasEOL ? "\n" : " ");
            prevY = y;
          }
        }
        text += "\n\n";
      }
      if (text.trim().length < 30)
        throw new Error(
          "This PDF has no readable text. Upload a text-based PDF or Word (.docx) file.",
        );
      return text.slice(0, 150000);
    } finally {
      await task.destroy();
    }
  }
  if (/\.docx$/i.test(file.name)) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    if (result.value.trim().length < 30)
      throw new Error("This Word file does not contain enough text.");
    return result.value.slice(0, 150000);
  }
  throw new Error(
    "Choose a PDF or Word (.docx) file. Save older .doc files as .docx first.",
  );
}
export function saveFile(
  data: Blob | Uint8Array | string,
  name: string,
  mime = "text/plain",
) {
  const blob =
    data instanceof Blob
      ? data
      : new Blob(
          [
            typeof data === "string"
              ? data
              : (new Uint8Array(data) as BlobPart),
          ],
          { type: mime },
        );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const texEscape = (s: string) =>
  s.replace(
    /[\\{}$&#%_^~]/g,
    (c) =>
      ({
        "\\": "\\textbackslash{}",
        "{": "\\{",
        "}": "\\}",
        $: "\\$",
        "&": "\\&",
        "#": "\\#",
        "%": "\\%",
        _: "\\_",
        "^": "\\textasciicircum{}",
        "~": "\\textasciitilde{}",
      })[c]!,
  );
export function resumeLatex(p: ResumeProfile) {
  return (
    String.raw`% ApplyDesk resume — candidate-reviewed facts only
\documentclass[letterpaper,11pt,dvipsnames]{article}
\usepackage{newtxtext}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage{tabularx}
\input{glyphtounicode}
\pdfgentounicode=1
\pagestyle{fancy}\fancyhf{}\renewcommand{\headrulewidth}{0pt}\renewcommand{\footrulewidth}{0pt}
\addtolength{\oddsidemargin}{-0.6in}\addtolength{\evensidemargin}{-0.5in}\addtolength{\textwidth}{1.19in}\addtolength{\topmargin}{-.7in}\addtolength{\textheight}{1.2in}
\urlstyle{same}\raggedbottom\raggedright\setlength{\tabcolsep}{0in}
\titleformat{\section}{\vspace{-7pt}\scshape\raggedright\large\bfseries}{}{0em}{}[\titlerule\vspace{-4pt}]
\setlength{\footskip}{4.1pt}
\begin{document}
\begin{center}
{\Large ` +
    texEscape(p.name) +
    String.raw`}\\[2pt]
\footnotesize ` +
    [p.phone, p.email, p.linkedin, p.location]
      .filter(Boolean)
      .map(texEscape)
      .join(" $|$ ") +
    String.raw`
\end{center}
` +
    sections
      .filter((k) => p[k])
      .map(
        (k) =>
          "\\section{" +
          profileLabels[k] +
          "}\n\\begin{itemize}[leftmargin=0.15in,label={}]\n\\small{\\item{" +
          texEscape(p[k]).split("\n").filter(Boolean).join(" \\\\\n") +
          "}}\n\\end{itemize}",
      )
      .join("\n") +
    "\n\\end{document}\n"
  );
}
export async function exportResume(
  p: ResumeProfile,
  format: "pdf" | "docx" | "tex",
  base = "ApplyDesk-resume",
) {
  if (format === "tex") {
    saveFile(resumeLatex(p), base + ".tex", "application/x-tex");
    return;
  }
  if (format === "docx") {
    const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } =
      await import("docx");
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 700, bottom: 700, left: 750, right: 750 },
            },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: p.name,
                  bold: true,
                  size: 32,
                  font: "Times New Roman",
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: [p.phone, p.email, p.linkedin, p.location]
                    .filter(Boolean)
                    .join(" | "),
                  size: 18,
                  font: "Times New Roman",
                }),
              ],
            }),
            ...sections
              .filter((k) => p[k])
              .flatMap((k) => [
                new Paragraph({
                  spacing: { before: 180, after: 80 },
                  border: {
                    bottom: {
                      style: BorderStyle.SINGLE,
                      size: 5,
                      color: "333333",
                    },
                  },
                  children: [
                    new TextRun({
                      text: profileLabels[k].toUpperCase(),
                      bold: true,
                      size: 24,
                      font: "Times New Roman",
                    }),
                  ],
                }),
                ...p[k]
                  .split("\n")
                  .filter(Boolean)
                  .map(
                    (line) =>
                      new Paragraph({
                        spacing: { after: 55 },
                        children: [
                          new TextRun({
                            text: line,
                            size: 21,
                            font: "Times New Roman",
                          }),
                        ],
                      }),
                  ),
              ]),
          ],
        },
      ],
    });
    saveFile(await Packer.toBlob(doc), base + ".docx");
    return;
  }
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman),
    bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  let page = pdf.addPage([612, 792]),
    y = 750;
  const safe = (s: string) =>
    s
      .replace(/[‐‑‒–—]/g, "-")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"');
  // Never silently remove a candidate's name or mathematical symbols.
  // Word export preserves Unicode when the standard PDF font cannot encode it.
  try {
    for (const value of Object.values(p)) font.encodeText(safe(value).replace(/\s+/g, " "));
  } catch {
    throw new Error("Some characters need a different PDF font. Download Word to preserve all your text, then export it as PDF.");
  }
  function write(line: string, size = 10.5, b = false, center = false) {
    const f = b ? bold : font;
    const words = safe(line).split(/\s+/);
    let row = "";
    const draw = (t: string) => {
      if (y < 43) {
        page = pdf.addPage([612, 792]);
        y = 750;
      }
      page.drawText(t, {
        x: center ? (612 - f.widthOfTextAtSize(t, size)) / 2 : 40,
        y,
        size,
        font: f,
        color: rgb(0.08, 0.08, 0.08),
      });
      y -= size + 3;
    };
    for (const word of words) {
      if (f.widthOfTextAtSize((row + " " + word).trim(), size) > 530 && row) {
        draw(row);
        row = word;
      } else row += (row ? " " : "") + word;
    }
    if (row) draw(row);
  }
  write(p.name, 17, true, true);
  write(
    [p.phone, p.email, p.linkedin, p.location].filter(Boolean).join(" | "),
    9,
    false,
    true,
  );
  y -= 8;
  for (const key of sections) {
    if (!p[key]) continue;
    if (y < 90) {
      page = pdf.addPage([612, 792]);
      y = 750;
    }
    y -= 8;
    write(profileLabels[key].toUpperCase(), 12, true);
    page.drawLine({
      start: { x: 40, y: y + 7 },
      end: { x: 572, y: y + 7 },
      thickness: 0.6,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 3;
    p[key]
      .split("\n")
      .filter(Boolean)
      .forEach((l) => write(l));
  }
  saveFile(await pdf.save(), base + ".pdf", "application/pdf");
}
