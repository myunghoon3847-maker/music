"use strict";

(() => {
  const STORAGE_KEY = "hoonMusicProjectsV1";
  const CURRENT_KEY = "hoonMusicCurrentProjectV1";
  const DEFAULT_ID = "project-default";

  const cleanText = (value, max) => String(value || "").trim().slice(0, max);

  function defaultProject() {
    const now = Date.now();
    return {
      id: DEFAULT_ID,
      name: "기본 녹음 프로젝트",
      memo: "기존 녹음과 빠른 테스트를 보관하는 기본 공간입니다.",
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now
    };
  }

  function readProjects() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const list = Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.name) : [];
      if (!list.some((item) => item.id === DEFAULT_ID)) list.unshift(defaultProject());
      return list;
    } catch {
      return [defaultProject()];
    }
  }

  function writeProjects(projects) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    window.dispatchEvent(new CustomEvent("hoon:projects-updated", { detail: { projects } }));
  }

  function getCurrentId() {
    const projects = readProjects();
    const saved = localStorage.getItem(CURRENT_KEY);
    return projects.some((item) => item.id === saved) ? saved : DEFAULT_ID;
  }

  function setCurrentId(id) {
    const projects = readProjects();
    const project = projects.find((item) => item.id === id) || projects[0];
    localStorage.setItem(CURRENT_KEY, project.id);
    touch(project.id);
    window.dispatchEvent(new CustomEvent("hoon:project-changed", { detail: { project } }));
    return project;
  }

  function getCurrent() {
    const projects = readProjects();
    return projects.find((item) => item.id === getCurrentId()) || projects[0];
  }

  function create({ name, memo = "" }) {
    const projects = readProjects();
    const now = Date.now();
    const project = {
      id: `project-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: cleanText(name, 48) || `새 프로젝트 ${projects.length + 1}`,
      memo: cleanText(memo, 300),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now
    };
    projects.push(project);
    writeProjects(projects);
    setCurrentId(project.id);
    return project;
  }

  function update(id, patch = {}) {
    const projects = readProjects();
    const index = projects.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = projects[index];
    projects[index] = {
      ...current,
      name: patch.name === undefined ? current.name : (cleanText(patch.name, 48) || current.name),
      memo: patch.memo === undefined ? current.memo : cleanText(patch.memo, 300),
      updatedAt: Date.now()
    };
    writeProjects(projects);
    return projects[index];
  }

  function remove(id) {
    if (id === DEFAULT_ID) return false;
    const projects = readProjects();
    if (!projects.some((item) => item.id === id)) return false;
    const wasCurrent = getCurrentId() === id;
    writeProjects(projects.filter((item) => item.id !== id));
    if (wasCurrent) setCurrentId(DEFAULT_ID);
    return true;
  }

  function touch(id = getCurrentId()) {
    const projects = readProjects();
    const index = projects.findIndex((item) => item.id === id);
    if (index < 0) return;
    projects[index] = { ...projects[index], lastUsedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }

  function normalizeRecordingProjectId(value) {
    return readProjects().some((item) => item.id === value) ? value : DEFAULT_ID;
  }

  window.HoonProjects = {
    DEFAULT_ID,
    list: readProjects,
    getCurrentId,
    getCurrent,
    setCurrentId,
    create,
    update,
    remove,
    touch,
    normalizeRecordingProjectId
  };
})();
