"use strict";

(() => {
  function clone(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
  }

  function create(limit = 60) {
    const undoStack = [];
    const redoStack = [];
    return {
      push(snapshot, label = "편집") {
        undoStack.push({ snapshot: clone(snapshot), label });
        if (undoStack.length > limit) undoStack.shift();
        redoStack.length = 0;
      },
      undo(current) {
        const item = undoStack.pop();
        if (!item) return null;
        redoStack.push({ snapshot: clone(current), label: item.label });
        return { snapshot: clone(item.snapshot), label: item.label };
      },
      redo(current) {
        const item = redoStack.pop();
        if (!item) return null;
        undoStack.push({ snapshot: clone(current), label: item.label });
        return { snapshot: clone(item.snapshot), label: item.label };
      },
      clear() { undoStack.length = 0; redoStack.length = 0; },
      canUndo() { return undoStack.length > 0; },
      canRedo() { return redoStack.length > 0; },
      labels() { return { undo: undoStack.at(-1)?.label || "", redo: redoStack.at(-1)?.label || "" }; }
    };
  }

  window.HoonEditHistory = { create };
})();
