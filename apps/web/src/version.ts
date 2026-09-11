/**
 * The build, stamped onto every row this client writes — proposal 03 §1.
 *
 * A number computed by one version of the calibration functions is not the
 * same claim as the same number computed by another, so a result has to be
 * reproducible against a build rather than against "the app".
 *
 * Injected by Vite from the package version and the commit when one is
 * available; `dev` when neither is.
 */
const env = import.meta.env as Record<string, string | undefined>;

export const APP_VERSION: string = env['VITE_APP_VERSION'] ?? 'dev';
