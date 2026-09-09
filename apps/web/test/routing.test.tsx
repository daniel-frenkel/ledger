/**
 * The router contract the service worker depends on.
 *
 * Offline, the worker answers every navigation that is not /v1/ with the
 * precached index.html, so the app always boots *at the deep link* with no
 * server-side routing: /resolve/<id> and /join arrive as a cold start, not as
 * a click from /. These tests pin what has to be true for that to work.
 *
 * Two techniques, because they prove different things:
 *
 *   matchRoutes           pure, no rendering — which route a path selects.
 *   renderToStaticMarkup  what the matched element sees in useLocation() and
 *                         useParams() on the very first render.
 *
 * MemoryRouter rather than BrowserRouter: parsing a URL into pathname/search/
 * hash is the part that can change between router majors, and reading
 * window.location is BrowserRouter's job, which needs a DOM.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Outlet, Route, Routes, matchRoutes, useLocation, useParams } from 'react-router-dom';

/** The route table in src/App.tsx, signed in, plus the /join route Prompt 7 adds. */
const ROUTES = [
  { path: '/' },
  { path: '/ledger' },
  { path: '/settings' },
  { path: '/predict' },
  { path: '/resolve/:id' },
  { path: '/join' },
  { path: '*' },
];

/** The path of the route a URL ends up in, or undefined for no match at all. */
const routeFor = (pathname: string): string | undefined => matchRoutes(ROUTES, { pathname })?.at(-1)?.route.path;

/** Reports what the router made of the URL. */
function Probe({ name }: { name: string }) {
  const l = useLocation();
  const { id } = useParams();
  return (
    <i>
      {name}|{l.pathname}|{l.search}|{l.hash}|{id ?? '-'}
    </i>
  );
}

const at = (url: string): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<Outlet />}>
          <Route path="/" element={<Probe name="open" />} />
          <Route path="/ledger" element={<Probe name="ledger" />} />
          <Route path="/settings" element={<Probe name="settings" />} />
        </Route>
        <Route path="/predict" element={<Probe name="predict" />} />
        <Route path="/resolve/:id" element={<Probe name="resolve" />} />
        <Route path="/join" element={<Probe name="join" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('a cold start at a deep link, as the cached shell delivers it', () => {
  it('selects the right route for every path in the table', () => {
    expect(routeFor('/')).toBe('/');
    expect(routeFor('/ledger')).toBe('/ledger');
    expect(routeFor('/settings')).toBe('/settings');
    expect(routeFor('/predict')).toBe('/predict');
    expect(routeFor('/resolve/01J8ZK9Q0000000000000000')).toBe('/resolve/:id');
    expect(routeFor('/join')).toBe('/join');
  });

  it('renders each one on the first pass', () => {
    expect(at('/')).toContain('open|/|||-');
    expect(at('/ledger')).toContain('ledger|/ledger');
    expect(at('/settings')).toContain('settings|/settings');
    expect(at('/predict')).toContain('predict|/predict');
  });

  it('extracts the id from /resolve/:id', () => {
    expect(at('/resolve/01J8ZK9Q0000000000000000')).toContain('|01J8ZK9Q0000000000000000</i>');
  });

  it('sends an unknown path to the catch-all rather than nothing', () => {
    // The catch-all renders <Navigate to="/" replace>, so a stale bookmark
    // lands on Open instead of a blank screen.
    expect(routeFor('/nope')).toBe('*');
    expect(routeFor('/resolve')).toBe('*');
  });
});

describe('a URL fragment survives the first load', () => {
  // /join lands from an emailed invite as https://…/join#token=…, and the
  // fragment is the whole point: it is never sent to a server, so it never
  // reaches the service worker either. The route has to see it on the first
  // render, before any navigation happens.
  it('keeps the fragment on /join and leaves the pathname clean', () => {
    // pathname stays /join with nothing glued on; the fragment lands in hash.
    expect(at('/join#invite=abc.def123')).toContain('join|/join||#invite=abc.def123|');
  });

  it('keeps a fragment and a query string apart', () => {
    expect(at('/join?src=email#invite=abc.def123')).toContain('join|/join|?src=email|#invite=abc.def123|');
  });

  it('does not treat a # inside the fragment as a new one', () => {
    expect(at('/join#a=1#b=2')).toContain('|#a=1#b=2|');
  });

  it('does not let a fragment change which route matches', () => {
    // Worth pinning: if a fragment ever leaked into the pathname, /join#token
    // would fall through to the catch-all and the invite would be swallowed.
    expect(routeFor('/join')).toBe('/join');
    expect(at('/join#invite=abc')).toContain('join|/join');
  });
});
