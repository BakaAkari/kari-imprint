import { useCallback, useReducer } from 'react';
import type { ImprintConfig } from '../../../web/src/types';
import { sameConfig } from './editor-state';

/**
 * One photo's editing document: the working config, the config last known to
 * be saved on the server (`baseline`), and undo/redo stacks.  Continuous
 * edits (typing, dragging a slider or colour picker) that share a `key`
 * within COALESCE_MS collapse into a single undo step.
 */
export type EditorDoc = {
  config: ImprintConfig;
  baseline: ImprintConfig | null;
  undo: ImprintConfig[];
  redo: ImprintConfig[];
  lastKey: string | null;
  lastAt: number;
};

const COALESCE_MS = 700;
const LIMIT = 100;

export type Action =
  | { type: 'load'; config: ImprintConfig; baseline: ImprintConfig | null }
  | { type: 'commit'; config: ImprintConfig; key?: string; at: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; config: ImprintConfig };

export function reduce(doc: EditorDoc, action: Action): EditorDoc {
  switch (action.type) {
    case 'load':
      return { config: action.config, baseline: action.baseline, undo: [], redo: [], lastKey: null, lastAt: 0 };
    case 'commit': {
      if (sameConfig(action.config, doc.config)) return doc;
      const coalesce = action.key && action.key === doc.lastKey && action.at - doc.lastAt < COALESCE_MS;
      const undo = coalesce ? doc.undo : [...doc.undo, doc.config].slice(-LIMIT);
      return { ...doc, config: action.config, undo, redo: [], lastKey: action.key ?? null, lastAt: action.at };
    }
    case 'undo': {
      if (!doc.undo.length) return doc;
      const previous = doc.undo[doc.undo.length - 1];
      return { ...doc, config: previous, undo: doc.undo.slice(0, -1), redo: [...doc.redo, doc.config], lastKey: null };
    }
    case 'redo': {
      if (!doc.redo.length) return doc;
      const next = doc.redo[doc.redo.length - 1];
      return { ...doc, config: next, redo: doc.redo.slice(0, -1), undo: [...doc.undo, doc.config], lastKey: null };
    }
    case 'saved':
      return { ...doc, baseline: action.config };
  }
}

export function useEditorDoc(initial: ImprintConfig) {
  const [doc, dispatch] = useReducer(reduce, undefined, () => ({ config: initial, baseline: initial, undo: [], redo: [], lastKey: null, lastAt: 0 }));
  const load = useCallback((config: ImprintConfig, baseline: ImprintConfig | null) => dispatch({ type: 'load', config, baseline }), []);
  const commit = useCallback((config: ImprintConfig, key?: string) => dispatch({ type: 'commit', config, key, at: Date.now() }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const markSaved = useCallback((config: ImprintConfig) => dispatch({ type: 'saved', config }), []);
  // The baseline is the stored config, or the product default for a photo
  // that was never saved; "dirty" means the working copy differs from it.
  const dirty = !sameConfig(doc.config, doc.baseline);
  return { doc, dirty, load, commit, undo, redo, markSaved };
}
