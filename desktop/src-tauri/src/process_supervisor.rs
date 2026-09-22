use std::{
    io::{Read, Write},
    net::{IpAddr, SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const OUTPUT_LIMIT: usize = 64 * 1024;

#[derive(Debug)]
pub struct AtlasServerConfig {
    pub executable: PathBuf,
    pub working_directory: PathBuf,
    pub address: SocketAddr,
    pub capability: String,
    pub arguments: Vec<String>,
    pub database_path: PathBuf,
    pub startup_timeout: Duration,
}

impl AtlasServerConfig {
    pub fn new(executable: PathBuf, working_directory: PathBuf, address: SocketAddr, capability: impl Into<String>) -> Self {
        Self {
            executable,
            working_directory: working_directory.clone(),
            address,
            capability: capability.into(),
            arguments: Vec::new(),
            database_path: working_directory.join(".atlas").join("atlas.db"),
            startup_timeout: Duration::from_secs(15),
        }
    }

    pub fn validate(&self) -> Result<(), SupervisorError> {
        if !matches!(self.address.ip(), IpAddr::V4(address) if address.is_loopback()) && !matches!(self.address.ip(), IpAddr::V6(address) if address.is_loopback()) {
            return Err(SupervisorError::InvalidConfiguration("Atlas must bind to loopback only."));
        }
        if self.address.port() == 0 { return Err(SupervisorError::InvalidConfiguration("Atlas needs a concrete reserved port.")); }
        if self.capability.len() < 24 || !self.capability.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
            return Err(SupervisorError::InvalidConfiguration("Atlas launch capability is invalid."));
        }
        if !self.working_directory.is_dir() { return Err(SupervisorError::InvalidConfiguration("Atlas working directory is unavailable.")); }
        Ok(())
    }
}

#[derive(Debug)]
pub enum SupervisorError {
    InvalidConfiguration(&'static str),
    Io(std::io::Error),
    StartupTimeout(String),
}

impl From<std::io::Error> for SupervisorError {
    fn from(value: std::io::Error) -> Self { Self::Io(value) }
}

impl std::fmt::Display for SupervisorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfiguration(message) => formatter.write_str(message),
            Self::Io(error) => write!(formatter, "Atlas server process failed: {error}"),
            Self::StartupTimeout(output) => write!(formatter, "Atlas server did not become ready before the deadline. {output}"),
        }
    }
}

impl std::error::Error for SupervisorError {}

pub struct LocalServerHandle {
    child: Child,
    pub address: SocketAddr,
    pub capability: String,
    output: Arc<Mutex<String>>,
}

impl LocalServerHandle {
    pub fn base_url(&self) -> String { format!("http://{}", self.address) }

    pub fn stop(&mut self) -> Result<(), SupervisorError> {
        if self.child.try_wait()?.is_some() { return Ok(()); }
        #[cfg(unix)]
        unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM); }
        #[cfg(not(unix))]
        self.child.kill()?;
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if self.child.try_wait()?.is_some() { return Ok(()); }
            thread::sleep(Duration::from_millis(50));
        }
        self.child.kill()?;
        self.child.wait()?;
        Ok(())
    }
}

impl Drop for LocalServerHandle {
    fn drop(&mut self) { let _ = self.stop(); }
}

pub fn reserve_loopback_address() -> Result<SocketAddr, SupervisorError> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let address = listener.local_addr()?;
    drop(listener);
    Ok(address)
}

pub fn start_atlas_server(config: AtlasServerConfig) -> Result<LocalServerHandle, SupervisorError> {
    config.validate()?;
    if let Some(parent) = config.database_path.parent() { std::fs::create_dir_all(parent)?; }
    let output = Arc::new(Mutex::new(String::new()));
    let mut child = Command::new(&config.executable)
        .args(&config.arguments)
        .current_dir(&config.working_directory)
        .env("ATLAS_HOST", "127.0.0.1")
        .env("ATLAS_PORT", config.address.port().to_string())
        .env("ATLAS_DB", &config.database_path)
        .env("ATLAS_CAPABILITY", &config.capability)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(stream) = child.stdout.take() { capture_output(stream, Arc::clone(&output)); }
    if let Some(stream) = child.stderr.take() { capture_output(stream, Arc::clone(&output)); }
    let mut handle = LocalServerHandle { child, address: config.address, capability: config.capability, output };
    let deadline = Instant::now() + config.startup_timeout;
    while Instant::now() < deadline {
        if handle.child.try_wait()?.is_some() { return Err(SupervisorError::StartupTimeout(captured(&handle.output))); }
        if ready(&handle.address, &handle.capability) { return Ok(handle); }
        thread::sleep(Duration::from_millis(80));
    }
    let output = captured(&handle.output);
    let _ = handle.stop();
    Err(SupervisorError::StartupTimeout(output))
}

fn ready(address: &SocketAddr, capability: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(address, Duration::from_millis(250)) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let request = format!("GET /api/health HTTP/1.1\r\nHost: localhost\r\nX-Atlas-Capability: {capability}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() { return false; }
    let mut response = [0_u8; 128];
    stream.read(&mut response).map(|count| String::from_utf8_lossy(&response[..count]).starts_with("HTTP/1.1 200")).unwrap_or(false)
}

fn capture_output(mut stream: impl Read + Send + 'static, output: Arc<Mutex<String>>) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        while let Ok(count) = stream.read(&mut buffer) {
            if count == 0 { break; }
            let text = String::from_utf8_lossy(&buffer[..count]);
            if let Ok(mut value) = output.lock() {
                value.push_str(&text);
                if value.len() > OUTPUT_LIMIT { let trim = value.len() - OUTPUT_LIMIT; value.drain(..trim); }
            }
        }
    });
}

fn captured(output: &Arc<Mutex<String>>) -> String {
    output.lock().map(|value| value.replace('\n', " ").chars().take(800).collect()).unwrap_or_else(|_| "Atlas output was unavailable.".into())
}
