//! Native → web notifications go through Atlas's own loopback server, so the
//! web UI never needs Tauri IPC for them. The request carries the per-launch
//! capability like every other Atlas API call.
use std::{
    io::{self, Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};

#[derive(Clone, Debug)]
pub struct Loopback {
    pub address: SocketAddr,
    pub capability: String,
}

impl Loopback {
    /// POSTs a JSON body and returns the HTTP status code.
    pub fn post_json(&self, path: &str, body: &serde_json::Value) -> io::Result<u16> {
        let payload = serde_json::to_vec(body).map_err(io::Error::other)?;
        let mut stream = TcpStream::connect_timeout(&self.address, Duration::from_secs(2))?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        let head = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Atlas-Capability: {capability}\r\nContent-Type: application/json\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n",
            port = self.address.port(),
            capability = self.capability,
            length = payload.len(),
        );
        stream.write_all(head.as_bytes())?;
        stream.write_all(&payload)?;
        let mut response = [0_u8; 64];
        let count = stream.read(&mut response)?;
        parse_status(&response[..count]).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Atlas returned an invalid HTTP response."))
    }
}

pub fn parse_status(response: &[u8]) -> Option<u16> {
    let line = std::str::from_utf8(response).ok()?.lines().next()?;
    let mut parts = line.split_whitespace();
    if !parts.next()?.starts_with("HTTP/1.") {
        return None;
    }
    parts.next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::parse_status;

    #[test]
    fn reads_the_status_code() {
        assert_eq!(parse_status(b"HTTP/1.1 202 Accepted\r\n"), Some(202));
        assert_eq!(parse_status(b"garbage"), None);
    }
}
