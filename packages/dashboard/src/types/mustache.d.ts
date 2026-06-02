// Minimal ambient declaration for the logic-less Mustache renderer. The shared
// ACR template is rendered with Mustache on both the dashboard and (via a PHP
// port) the WordPress plugin, so the engine must stay logic-less.
declare module 'mustache' {
  const Mustache: {
    render(template: string, view: unknown, partials?: Record<string, string>): string;
  };
  export default Mustache;
}
