import wasmUrl from 'web-ifc/web-ifc.wasm?url';

/**
 * Directory the web-ifc runtime loads its `.wasm` from. Vite resolves the file to a
 * served URL in development and to an emitted asset in production; the desktop app's
 * build config keeps the file name unhashed so web-ifc's own file lookup still works.
 */
export const IFC_WASM_DIR = wasmUrl.slice(0, wasmUrl.lastIndexOf('/') + 1);
