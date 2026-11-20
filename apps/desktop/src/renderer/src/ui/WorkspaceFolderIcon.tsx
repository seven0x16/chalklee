/** `skills` marks the workspace's "技能" folder with ChalkLee AI's sparkle, in the folder's own colours. */
export function WorkspaceFolderIcon({ open, skills = false, size = 16 }: { open: boolean; skills?: boolean; size?: number }) {
  return (
    <svg className={`workspace-folder-icon ${open ? "is-open" : "is-closed"}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={open
          ? "M1 3.5C1 2.81 1.56 2.25 2.25 2.25H5.05C5.45 2.25 5.83 2.44 6.07 2.76L6.81 3.74C7.05 4.06 7.43 4.25 7.83 4.25H12.75C13.44 4.25 14 4.81 14 5.5V6.75L11.1 13.75H2.25C1.56 13.75 1 13.19 1 12.5Z"
          : "M1 3.5C1 2.81 1.56 2.25 2.25 2.25H5.05C5.45 2.25 5.83 2.44 6.07 2.76L6.81 3.74C7.05 4.06 7.43 4.25 7.83 4.25H12.75C13.44 4.25 14 4.81 14 5.5V12.5C14 13.19 13.44 13.75 12.75 13.75H2.25C1.56 13.75 1 13.19 1 12.5Z"}
        fill="var(--cm-folder-icon-back)"
      />
      <path
        d={open
          ? "M4.4 6H14.15C14.9 6 15.43 6.73 15.2 7.44L13.01 12.88C12.85 13.4 12.37 13.75 11.83 13.75H2.1C1.35 13.75 .82 13.02 1.05 12.31L3.21 6.87C3.37 6.35 3.85 6 4.4 6Z"
          : "M1 5.25H13.25C13.94 5.25 14.5 5.81 14.5 6.5V12.5C14.5 13.19 13.94 13.75 13.25 13.75H2.25C1.56 13.75 1 13.19 1 12.5Z"}
        fill="var(--cm-folder-icon-front)"
      />
      {skills ? <path className="workspace-folder-skills" d="M7.9 6.8Q8.2 9.4 10.8 9.7Q8.2 10 7.9 12.6Q7.6 10 5 9.7Q7.6 9.4 7.9 6.8Z" fill="var(--cm-folder-icon-back)" /> : null}
    </svg>
  );
}
