import { guessSheetFields, type TextRun } from './pdf';

function run(text: string, x: number, y: number, h = 0.012): TextRun {
  return { text, x, y, w: text.length * h * 0.5, h };
}

describe('guessSheetFields', () => {
  it('reads the number next to a "Sheet No" label and the title from the title block', () => {
    const runs = [
      run('GROUND FLOOR FRAMING PLAN  1:100', 0.1, 0.5, 0.017),
      run('KINGPOST CONNECT SAMPLE PROJECT', 0.7, 0.82, 0.013),
      run('REV A    DATE 24/10/2026    SCALE 1:100', 0.7, 0.86, 0.01),
      run('TITLE', 0.7, 0.89, 0.01),
      run('GROUND FLOOR FRAMING PLAN', 0.7, 0.93, 0.019),
      run('SHEET NO', 0.85, 0.89, 0.01),
      run('S-101', 0.85, 0.94, 0.028),
    ];
    expect(guessSheetFields(runs)).toEqual({ number: 'S-101', title: 'GROUND FLOOR FRAMING PLAN' });
  });

  it('falls back to a code-like run and leaves the title empty when nothing fits', () => {
    const runs = [run('notes in lower case', 0.6, 0.8), run('A-01', 0.9, 0.95)];
    expect(guessSheetFields(runs)).toEqual({ number: 'A-01', title: null });
  });

  it('gives nothing for a page without a title block', () => {
    expect(guessSheetFields([run('Some text', 0.1, 0.1)])).toEqual({ number: null, title: null });
  });
});
