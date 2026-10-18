/** Small brand marks for the "open in" links. */
export const SpotifyLogo = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="12" cy="12" r="12" fill="#1ED760" />
    <g fill="none" stroke="#000" strokeLinecap="round">
      <path d="M6.2 9.4c3.9-1.2 8.3-.9 11.8 1" strokeWidth="1.9" />
      <path d="M6.8 12.6c3.2-.9 6.8-.6 9.7.9" strokeWidth="1.6" />
      <path d="M7.4 15.6c2.6-.7 5.3-.5 7.6.7" strokeWidth="1.3" />
    </g>
  </svg>
);

export const AppleMusicLogo = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <defs>
      <linearGradient id="am-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FA5C76" />
        <stop offset="1" stopColor="#FA233B" />
      </linearGradient>
    </defs>
    <rect width="24" height="24" rx="5.5" fill="url(#am-g)" />
    <path d="M15.8 5.6v8.9a2.3 2.3 0 1 1-1.5-2.2V8.5l-5 1.1v6.6a2.3 2.3 0 1 1-1.5-2.2V7.4z" fill="#fff" />
  </svg>
);

export const GitHubLogo = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="currentColor">
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);
