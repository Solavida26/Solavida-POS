"""Read-only Live backup. All restores and migration checks target disposable Docker only."""
import os, pathlib, subprocess, tempfile, json, hashlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
password = os.environ.get('SOLAVIDA_DB_PASSWORD', '')
if not password:
    raise SystemExit('Missing SOLAVIDA_DB_PASSWORD repository secret.')
if len(password) < 12:
    raise SystemExit('Backup encryption requires a separate strong passphrase; no database changes made.')
work = pathlib.Path(tempfile.mkdtemp(prefix='solavida-backup-'))
os.chmod(work, 0o700)
container = 'solavida-recovery-check'
remote = dict(os.environ, PGHOST='aws-0-ap-southeast-2.pooler.supabase.com', PGPORT='5432', PGUSER='postgres.novgwsnjlgrkzqnpajlx', PGDATABASE='postgres', PGPASSWORD=password, PGSSLMODE='require', PGCONNECT_TIMEOUT='30', PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=180000')
# Only environment variable NAMES enter command arguments. Credentials are never printed.
def client(command, args, local=False, input=None):
    env = dict(remote)
    if local:
        env.update(PGHOST='127.0.0.1', PGPORT='55439', PGUSER='postgres', PGPASSWORD='isolated-recovery-only', PGSSLMODE='disable', PGOPTIONS='')
    names = ['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE','PGCONNECT_TIMEOUT','PGOPTIONS']
    cmd = ['docker','run','--rm','--network','host','-i','-v',str(work)+':/backup']
    for name in names: cmd += ['-e', name]
    result = subprocess.run(cmd+['postgres:17',command]+args,env=env,input=input,capture_output=True)
    if result.returncode:
        # SQL errors can include customer values: retain diagnostics locally, never print them.
        (work / 'private-error.log').write_bytes(result.stderr)
        error = result.stderr.decode(errors='replace').lower()
        categories = ['password authentication failed', 'tenant or user not found', 'connection timed out', 'timeout expired', 'could not translate host name', 'connection refused', 'unsupported startup parameter', 'permission denied', 'unrecognized configuration parameter', 'read-only transaction', 'server version mismatch']
        category = next((c for c in categories if c in error), 'unclassified connection or restore error')
        if command == 'psql' and not local and args[-1].startswith('select current_database()'):
            # This first query has no business data. Redact the password defensively.
            print(result.stderr.decode(errors='replace').replace(password, '[REDACTED]')[-1800:], flush=True)
        raise RuntimeError(command+' failed: '+category+'. No Live writes were attempted.')
    return result.stdout

def sql(query, local=False):
    return client('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-c',query],local).decode().strip()

try:
    print('Stage: verify read-only source connection.', flush=True)
    identity = sql("select current_database() || ':' || current_user || ':' || current_setting('transaction_read_only')")
    if identity != 'postgres:postgres:on':
        raise RuntimeError('Unexpected source identity or read-only setting.')
    # Archive includes ACLs, owners, functions, policies, triggers, all table data and sequences.
    print('Stage: export database archive.', flush=True)
    client('pg_dump',['--format=custom','--schema=public','--schema=auth','--schema=storage','--schema=supabase_migrations','--lock-wait-timeout=15000','--file=/backup/database.dump'])
    print('Stage: export role and extension metadata.', flush=True)
    roles = sql("select json_agg(rolname) from pg_roles where rolname not like 'pg_%' and rolname <> 'postgres'")
    (work/'roles.json').write_text(roles)
    client('pg_dumpall',['--roles-only','--no-role-passwords','--file=/backup/roles.sql'])
    (work/'extensions.json').write_text(sql("select json_agg(json_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion)) from pg_extension e join pg_namespace n on n.oid=e.extnamespace"))
    subprocess.run(['docker','run','--detach','--name',container,'-e','POSTGRES_PASSWORD=isolated-recovery-only','-p','127.0.0.1:55439:5432','postgres:17'],check=True,stdout=subprocess.DEVNULL)
    import time
    for attempt in range(30):
        ready=subprocess.run(['docker','exec',container,'pg_isready','-U','postgres'],capture_output=True)
        if ready.returncode==0: break
        time.sleep(1)
    else: raise RuntimeError('Isolated recovery database did not start.')
    role_sql='\n'.join('CREATE ROLE "'+r.replace('"','""')+'";' for r in json.loads(roles))
    sql(role_sql+ '\nCREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions; CREATE EXTENSION "uuid-ossp" SCHEMA extensions;',True)
    # ACLs and owners are restored too; strict exit-on-error, no ignored errors.
    print('Stage: restore into isolated database.', flush=True)
    client('pg_restore',['--exit-on-error','--dbname=postgres','/backup/database.dump'],True)
    fingerprint_query = """DO $$ DECLARE r record; n bigint; h text; BEGIN
      CREATE TEMP TABLE recovery_fingerprints(name text, rows bigint, hash text);
      FOR r IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','auth','storage','supabase_migrations') ORDER BY 1,2 LOOP
        EXECUTE format('select count(*),md5(coalesce(string_agg(row_to_json(t)::text,E''\\n'' order by row_to_json(t)::text),'''')) from %I.%I t',r.schemaname,r.tablename) INTO n,h;
        INSERT INTO recovery_fingerprints VALUES(r.schemaname||'.'||r.tablename,n,h);
      END LOOP; END $$; SELECT coalesce(json_agg(recovery_fingerprints order by name),'[]') FROM recovery_fingerprints;"""
    print('Stage: verify migration preserves restored records.', flush=True)
    before = json.loads(sql(fingerprint_query,True))
    # Dry run proposed additive migration against restored real data, never against Live.
    migration = ROOT/'supabase/migrations/20261014124432_delivery_routes.sql'
    client('psql',['-X','-q','-v','ON_ERROR_STOP=1','--single-transaction'],True,input=migration.read_bytes())
    after = {r['name']:r for r in json.loads(sql(fingerprint_query,True))}
    if any(after.get(r['name']) != r for r in before):
        raise RuntimeError('Migration changed existing restored data; deployment blocked.')
    (work/'recovery-verification.json').write_text(json.dumps({'restored':True,'migration_preserved_all_existing_rows':True,'tables':before},indent=2))
    (work/'RECOVERY.txt').write_text('Solavida project novgwsnjlgrkzqnpajlx. Logical backup of public, auth, storage and supabase_migrations; includes schema, records, sequences, owners and ACLs. Roles dump excludes passwords. Extensions manifest included. Supabase service configuration, Vault secrets, Realtime internals and storage files are NOT included. Storage contained zero objects at preflight. Restore in a separate matching Supabase project; never overwrite Live with this old snapshot. GPG AES256 encryption uses the database password that existed WHEN THIS BACKUP WAS TAKEN. Retain that original password privately even after rotation. Isolated Postgres 17 restore and migration preservation check passed.\n')
    archive=work/'backup.tar.gz'
    subprocess.run(['tar','-czf',str(archive),'-C',str(work),'database.dump','roles.sql','roles.json','extensions.json','recovery-verification.json','RECOVERY.txt'],check=True)
    out=ROOT/'backup-output'; out.mkdir(exist_ok=True)
    encrypted=out/'solavida-pre-v90.tar.gz.gpg'
    # Password travels through stdin, not command line, file, or logs.
    args=['gpg','--batch','--yes','--pinentry-mode','loopback','--passphrase-fd','0']
    subprocess.run(args+['--symmetric','--cipher-algo','AES256','--s2k-mode','3','--s2k-count','65011712','--output',str(encrypted),str(archive)],input=password.encode(),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    recovered=work/'decrypt-check.tar.gz'
    subprocess.run(args+['--decrypt','--output',str(recovered),str(encrypted)],input=password.encode(),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if hashlib.sha256(recovered.read_bytes()).digest()!=hashlib.sha256(archive.read_bytes()).digest():
        raise RuntimeError('Encryption recovery verification failed.')
    (out/'SHA256SUMS').write_text(hashlib.sha256(encrypted.read_bytes()).hexdigest()+'  '+encrypted.name+'\n')
    print('PASS: read-only backup, strict isolated restore, existing-row preservation, encryption/decryption verification.')
finally:
    subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    import shutil
    shutil.rmtree(work,ignore_errors=True)
