import { removeCompanySamples } from "./company-draft.mjs";
import {
  freshWorkspace,
  migrateDraft,
  workspaceAction,
} from "./workspace-state.mjs";
const DB = "omnivoice-local-v2";
let opening;
export function openWorkspaceDB() {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error(
        "IndexedDB is unavailable. Enable browser storage to save your workspace.",
      ),
    );
  return (opening ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspace");
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        opening = null;
      };
      resolve(r.result);
    };
    r.onerror = () => {
      opening = null;
      reject(r.error);
    };
    r.onblocked = () => {
      opening = null;
      reject(new Error("Close older workspace tabs to update local storage."));
    };
  }));
}
export async function transactWorkspace(operation, mode = "readwrite") {
  const db = await openWorkspaceDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", mode);
    const store = tx.objectStore("workspace");
    const get = store.get("current");
    let result;
    let failure;
    get.onsuccess = () => {
      try {
        let state = get.result;
        if (!state) {
          let old;
          try {
            old = JSON.parse(
              globalThis.localStorage?.getItem("omnivoice-workspace-v1") ||
                "null",
            );
          } catch {}
          state = old ? migrateDraft(old) : freshWorkspace();
        }
        const cleaned = removeCompanySamples(state);
        result = operation(state);
        if (cleaned && result?.profile && Array.isArray(result?.documents))
          result.sample_content_removed = true;
        if (result?.then)
          throw new Error("IndexedDB operations must be synchronous");
        if (mode === "readwrite") {
          state.revision = (state.revision || 0) + 1;
          store.put(state, "current");
        }
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(
        failure ||
          tx.error ||
          new Error(
            "Workspace storage failed. Export a backup; browser storage may be full.",
          ),
      );
    tx.onerror = () => {};
  });
}
export const readWorkspace = () =>
  transactWorkspace((s) => structuredClone(s), "readonly");
export const localAction = (path, method, body) =>
  transactWorkspace(
    (s) =>
      workspaceAction(s, path, method, body, {
        storage: "browser",
        channel: "browser",
      }),
    method === "GET" ? "readonly" : "readwrite",
  );
export const updateWorkspace = (fn) =>
  transactWorkspace((s) => {
    fn(s);
    return structuredClone(s);
  });
export function resetDBHandleForTests() {
  opening = null;
}
