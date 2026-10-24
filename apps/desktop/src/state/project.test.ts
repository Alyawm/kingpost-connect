import { folderName } from './project';

describe('folderName', () => {
  it('takes the last segment of Windows and POSIX paths', () => {
    expect(folderName('C:\\Projects\\Bridge 7')).toBe('Bridge 7');
    expect(folderName('C:\\Projects\\Bridge 7\\')).toBe('Bridge 7');
    expect(folderName('/home/eng/projects/tower')).toBe('tower');
  });

  it('falls back to a generic name for an empty path', () => {
    expect(folderName('')).toBe('Project');
  });
});
