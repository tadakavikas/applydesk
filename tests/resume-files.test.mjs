import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,decodePDFRawStream} from 'pdf-lib';
import mammoth from 'mammoth';
import {loadResumeLibrary,candidateText,downloadHarness} from './resume-test-helpers.mjs';

const profile = loadResumeLibrary('model').parseProfile(candidateText);

function pdfDrawnText(pdf) {
  return pdf.getPages().flatMap(page => {
    const contents = page.node.Contents();
    if (!contents) return [];
    return contents.asArray().map(ref => {
      const decoded = Buffer.from(decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString('latin1');
      return [...decoded.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map(match=>Buffer.from(match[1],'hex').toString('latin1')).join(' ');
    });
  }).join('\n');
}

test('LaTeX export escapes user text instead of executing it as markup', () => {
  const {library} = downloadHarness();
  const tex = library.resumeLatex({...profile,name:'Jordan & Co_{Test} #1',summary:String.raw`Budget $50; improved 25%. Path C:\resume; ~ ^ \input{private}`});
  assert(tex.includes(String.raw`Jordan \& Co\_\{Test\} \#1`));
  assert(tex.includes(String.raw`Budget \$50; improved 25\%. Path C:\textbackslash{}resume; \textasciitilde{} \textasciicircum{} \textbackslash{}input\{private\}`));
  assert(!tex.includes(String.raw`\input{private}`));
  assert(tex.includes(String.raw`\section{Experience}`));
  assert(tex.includes(String.raw`\begin{document}`));
  assert(tex.trim().endsWith(String.raw`\end{document}`));
});

test('PDF download contains a real readable PDF document', async () => {
  const {library,downloads,revoked} = downloadHarness();
  await library.exportResume(profile,'pdf','candidate-resume');
  assert.equal(downloads.length,1);
  assert.equal(downloads[0].name,'candidate-resume.pdf');
  assert.equal(downloads[0].blob.type,'application/pdf');
  const bytes = new Uint8Array(await downloads[0].blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert(pdf.getPageCount()>=1);
  assert.deepEqual(pdf.getPage(0).getSize(),{width:612,height:792});
  const text = pdfDrawnText(pdf);
  for (const value of ['Jordan Candidate','EXPERIENCE','Example Analytics','Sample Systems','100 projects']) assert(text.includes(value),value);
  assert.equal(revoked.length,1);
});

test('long PDF resumes retain the final fact after a page break', async () => {
  const {library,downloads} = downloadHarness();
  const experience = Array.from({length:100},(_,i)=>'- Completed verified project ' + (i+1) + ' with a documented result.').join('\n');
  await library.exportResume({...profile,experience},'pdf');
  const pdf = await PDFDocument.load(await downloads[0].blob.arrayBuffer());
  assert(pdf.getPageCount()>1);
  assert(pdfDrawnText(pdf).includes('project 100 with a documented result.'));
});

test('DOCX download is a Word archive with the candidate facts and sections', async () => {
  const {library,downloads} = downloadHarness();
  await library.exportResume(profile,'docx','candidate-resume');
  assert.equal(downloads[0].name,'candidate-resume.docx');
  const bytes = Buffer.from(await downloads[0].blob.arrayBuffer());
  assert.equal(bytes.subarray(0,2).toString(),'PK');
  const {value} = await mammoth.extractRawText({buffer:bytes});
  for (const content of ['Jordan Candidate','candidate@example.test','EXPERIENCE','TECHNICAL SKILLS','EDUCATION','Example Analytics','Sample Systems','100 projects']) assert(value.includes(content),content);
  const imported = await library.extractResume(new File([bytes],'candidate-resume.docx'));
  assert(imported.includes('Jordan Candidate'));
  assert(imported.includes('Built Python data pipelines on AWS for 100 projects.'));
});

test('resume import rejects unsupported, oversized and unreadable Word files', async () => {
  const {library} = downloadHarness();
  await assert.rejects(library.extractResume(new File(['old format'],'resume.doc')),/PDF or Word/);
  await assert.rejects(library.extractResume(new File([new Uint8Array(5*1024*1024+1)],'resume.pdf')),/smaller than 5 MB/);
  const {library:writer,downloads} = downloadHarness();
  await writer.exportResume({...loadResumeLibrary('model').emptyProfile(),name:'A'},'docx');
  await assert.rejects(library.extractResume(new File([downloads[0].blob],'empty.docx')),/enough text/);
});

test('PDF export never silently deletes unsupported candidate characters', async () => {
  const {library,downloads}=downloadHarness();
  await assert.rejects(library.exportResume({...profile,name:'王 Candidate'},'pdf'),/Download Word to preserve all your text/);
  assert.equal(downloads.length,0);
});
