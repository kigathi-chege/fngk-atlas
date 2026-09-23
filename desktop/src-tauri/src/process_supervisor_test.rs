use std::{env, path::PathBuf, time::Duration};

use crate::process_supervisor::{reserve_loopback_address, start_atlas_server, AtlasServerConfig};

#[test]
fn rejects_non_loopback_server_addresses() {
    let config = AtlasServerConfig::new(
        PathBuf::from("/usr/bin/node"),
        PathBuf::from("/tmp/atlas"),
        "0.0.0.0:4317".parse().unwrap(),
        "desktop-capability-for-test",
    );

    assert!(config.validate().is_err());
}

#[test]
fn starts_a_loopback_server_only_after_capability_readiness() {
    let script = "const http=require('http');const expected=process.env.ATLAS_CAPABILITY;const server=http.createServer((request,response)=>{if(request.headers['x-atlas-capability']!==expected){response.writeHead(401);return response.end();}response.end('ok');});server.listen(Number(process.env.ATLAS_PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));";
    let mut config = AtlasServerConfig::new(
        PathBuf::from("node"),
        env::current_dir().unwrap(),
        reserve_loopback_address().unwrap(),
        "desktop-capability-for-test",
    );
    config.arguments = vec!["-e".into(), script.into()];
    config.startup_timeout = Duration::from_secs(5);

    let mut server = start_atlas_server(config).unwrap();
    assert!(server.base_url().starts_with("http://127.0.0.1:"));
    server.stop().unwrap();
}
