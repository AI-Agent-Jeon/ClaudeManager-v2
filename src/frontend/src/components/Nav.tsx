export type ViewKey = 'board' | 'agents' | 'conversations';

const NAV_ITEMS: { key: ViewKey; label: string }[] = [
  { key: 'board', label: '진행 보드' },
  { key: 'agents', label: 'Agent / Task' },
  { key: 'conversations', label: '대화' },
];

interface NavProps {
  active: ViewKey;
  onChange: (view: ViewKey) => void;
  onLogout: () => void;
}

export function Nav({ active, onChange, onLogout }: NavProps) {
  return (
    <nav className="flex h-screen w-52 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-4 py-5">
        <p className="text-sm font-semibold text-slate-900">ClaudeManager</p>
      </div>
      <ul className="flex-1 space-y-1 px-2">
        {NAV_ITEMS.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onChange(item.key)}
              className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium ${
                active === item.key
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-200 p-2">
        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100"
        >
          로그아웃
        </button>
      </div>
    </nav>
  );
}
