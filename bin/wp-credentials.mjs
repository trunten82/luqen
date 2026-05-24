#!/usr/bin/env node
/**
 * Phase 60 sub-phase 60.02 — Luqen WP provisioning CLI.
 *
 * For a given WP site URL, mints a `wp-plugin:<site-hash>` OAuth client
 * on each connected Luqen module and emits a single base64-encoded
 * bundle the operator pastes into the plugin's Connections page.
 *
 * Each module exposes its own `clients create` subcommand via its CLI
 * (packages/<module>/dist/cli.js). We invoke them locally — this CLI
 * MUST be run on the same host as the modules (or with appropriate
 * paths overridden via env).
 *
 * Usage:
 *   node bin/wp-credentials.mjs --site-url https://my-shop.example.com \
 *       [--config /root/luqen/dashboard.config.json] \
 *       [--modules compliance,branding,llm]
 *
 * Output: a single base64 string on stdout. Paste it into the bundle
 * textarea under Luqen → Connections on the target WP site.
 *
 * @package Luqen
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const ROOT      = path.resolve( __dirname, '..' );

const MODULE_DEFAULTS = {
	compliance: { port: 4000, scope: 'read', cliPath: 'packages/compliance/dist/cli.js' },
	branding:   { port: 4100, scope: 'read', cliPath: 'packages/branding/dist/cli.js' },
	llm:        { port: 4200, scope: 'admin', cliPath: 'packages/llm/dist/cli.js' },
};

function parseArgs( argv ) {
	const opts = {
		siteUrl: '',
		config:  path.join( ROOT, 'dashboard.config.json' ),
		modules: Object.keys( MODULE_DEFAULTS ).join( ',' ),
		json:    false,
		quiet:   false,
	};
	for ( let i = 2; i < argv.length; i++ ) {
		const a = argv[ i ];
		if ( a === '--site-url' )       { opts.siteUrl = argv[ ++i ]; }
		else if ( a === '--config' )    { opts.config  = argv[ ++i ]; }
		else if ( a === '--modules' )   { opts.modules = argv[ ++i ]; }
		else if ( a === '--json' )      { opts.json    = true; }
		else if ( a === '--quiet' )     { opts.quiet   = true; }
		else if ( a === '-h' || a === '--help' ) {
			console.log( `Usage:
  node bin/wp-credentials.mjs --site-url <url> [--config <path>] [--modules <list>] [--json] [--quiet]

Example:
  node bin/wp-credentials.mjs --site-url https://shop.example.com
` );
			process.exit( 0 );
		}
	}
	if ( ! opts.siteUrl ) {
		console.error( 'error: --site-url is required' );
		process.exit( 2 );
	}
	return opts;
}

function siteHash( url ) {
	return createHash( 'sha256' ).update( String( url ) ).digest( 'hex' ).slice( 0, 12 );
}

function provisionClient( moduleKey, defaults, clientName ) {
	const cliPath = path.join( ROOT, defaults.cliPath );
	const cliCwd  = path.dirname( path.dirname( cliPath ) ); // packages/<module>
	const args    = [ cliPath, 'clients', 'create', '--name', clientName ];
	if ( 'llm' === moduleKey ) {
		// LLM CLI: --scopes (plural CSV), no --grant.
		args.push( '--scopes', defaults.scope );
	} else {
		// Compliance / branding: --scope, --grant.
		args.push( '--scope', defaults.scope, '--grant', 'client_credentials' );
	}
	// Run the CLI from the module's package dir so it reads/writes the same
	// sqlite file the running service uses (services are run with WorkingDirectory
	// pointing at packages/<module>).
	const out = execFileSync( 'node', args, { encoding: 'utf8', cwd: cliCwd } );
	// Output format is consistent across modules:
	//   Client created:
	//     client_id:     <uuid>
	//     client_secret: <secret>
	//     name:          <name>
	//     scopes:        <csv>
	// Output varies by module:
	//   compliance / branding -> client_id: <id>  /  client_secret: <secret>
	//   llm                   -> ID: <id>          /  Secret: <secret>
	const id     = ( out.match( /(?:client_id|ID):\s*(\S+)/ )         || [ , '' ] )[ 1 ];
	const secret = ( out.match( /(?:client_secret|Secret):\s*(\S+)/ ) || [ , '' ] )[ 1 ];
	if ( ! id || ! secret ) {
		throw new Error( `${moduleKey}: could not parse client credentials from CLI output:\n${out}` );
	}
	return { id, secret, raw: out };
}

function readConfig( configPath ) {
	try {
		const raw = readFileSync( configPath, 'utf8' );
		return JSON.parse( raw );
	} catch ( e ) {
		return null;
	}
}

function publicUrlFor( moduleKey, defaults, config ) {
	// Prefer explicit *Url overrides from dashboard.config.json; else build
	// from localhost:<port> with the operator instructed to swap to the
	// publicly-reachable host on paste.
	if ( config ) {
		const key = `${moduleKey}Url`;
		if ( typeof config[ key ] === 'string' && config[ key ].length > 0 ) {
			return config[ key ];
		}
	}
	return `http://localhost:${defaults.port}`;
}

function main() {
	const opts     = parseArgs( process.argv );
	const config   = readConfig( opts.config );
	const requested = opts.modules.split( ',' ).map( ( s ) => s.trim() ).filter( Boolean );
	const hash      = siteHash( opts.siteUrl );
	const clientName = `wp-plugin:${hash}`;

	const bundle = {
		bundleVersion: 1,
		generatedAt:   new Date().toISOString(),
		siteUrl:       opts.siteUrl,
		clientName,
		modules:       {},
	};

	for ( const key of requested ) {
		const defaults = MODULE_DEFAULTS[ key ];
		if ( ! defaults ) {
			console.error( `warn: unknown module "${key}", skipping` );
			continue;
		}
		if ( ! opts.quiet ) {
			console.error( `[${key}] provisioning…` );
		}
		try {
			const cred = provisionClient( key, defaults, clientName );
			bundle.modules[ key ] = {
				base_url:      publicUrlFor( key, defaults, config ),
				client_id:     cred.id,
				client_secret: cred.secret,
				scopes:        defaults.scope,
			};
			if ( ! opts.quiet ) {
				console.error( `[${key}] ok: client_id=${cred.id}` );
			}
		} catch ( e ) {
			console.error( `[${key}] FAILED: ${e.message}` );
			process.exit( 3 );
		}
	}

	const json = JSON.stringify( bundle );
	if ( opts.json ) {
		process.stdout.write( json + '\n' );
	} else {
		process.stdout.write( Buffer.from( json, 'utf8' ).toString( 'base64' ) + '\n' );
	}
}

main();
