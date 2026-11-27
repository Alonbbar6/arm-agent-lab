import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Moon, Sun } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Laboratory from '@/pages/laboratory';
import EvalPage from '@/pages/eval';
import About from '@/pages/about';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

const NAV = [
  { href: '/', label: 'Laboratory' },
  { href: '/eval', label: 'Eval' },
  { href: '/about', label: 'About' },
];

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem('lab-theme') !== 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('lab-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] items-center gap-2 sm:gap-4 px-4 md:px-6 h-12">
          <Link href="/" className="flex shrink-0 items-center gap-2" data-testid="link-home">
            <svg viewBox="0 0 24 24" className="size-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 20h8M8 20v-4l5-7 5 3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="13" cy="9" r="1.6" /><path d="M18 10v4M20 10v4" strokeLinecap="round" />
            </svg>
            <span className="whitespace-nowrap text-sm sm:text-base font-semibold tracking-tight">Arm Agent Lab</span>
          </Link>
          <nav className="flex gap-0 sm:gap-1 sm:ml-2" aria-label="Main">
            {NAV.map((n) => {
              const active = location === n.href;
              return (
                <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
                  className={`relative rounded px-1.5 sm:px-2.5 py-1 text-xs sm:text-sm transition-colors ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  data-testid={`link-${n.label.toLowerCase()}`}>
                  {n.label}
                  {active && <span className="absolute inset-x-2.5 -bottom-[11px] h-0.5 bg-primary" />}
                </Link>
              );
            })}
          </nav>
          <button type="button" onClick={() => setDark((d) => !d)} aria-label="Toggle color theme"
            className="ml-auto rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary" data-testid="button-theme">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function Router() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Laboratory} />
          <Route path="/eval" component={EvalPage} />
          <Route path="/about" component={About} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
