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
