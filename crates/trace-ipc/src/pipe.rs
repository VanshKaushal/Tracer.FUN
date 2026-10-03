use super::*;
use std::{
    ffi::c_void,
    ptr::{null, null_mut},
    sync::mpsc,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::{Pipes::*, Threading::*},
};
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
pub fn user_sid() -> Result<String> {
    unsafe {
        let mut token = null_mut();
        anyhow::ensure!(
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) != 0,
            "OpenProcessToken failed"
        );
        let token = Handle(token);
        let mut size = 0;
        GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut size);
        let mut buf = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        anyhow::ensure!(
            GetTokenInformation(token.0, TokenUser, buf.as_mut_ptr().cast(), size, &mut size) != 0,
            "Cannot identify current user"
        );
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut str_sid = null_mut();
        anyhow::ensure!(
            ConvertSidToStringSidW(user.User.Sid, &mut str_sid) != 0,
            "Cannot encode user SID"
        );
        let mut len = 0;
        while *str_sid.add(len) != 0 {
            len += 1;
        }
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(str_sid, len));
        LocalFree(str_sid.cast());
        Ok(s)
    }
}
fn pipe_name() -> Result<Vec<u16>> {
    Ok(wide(&format!(r"\\.\pipe\Trace-{}", user_sid()?)))
}
pub struct SecurityDescriptor {
    pub attributes: SECURITY_ATTRIBUTES,
    descriptor: *mut c_void,
}
impl SecurityDescriptor {
    pub fn current_user() -> Result<Self> {
        unsafe {
            let sddl = wide(&format!("D:P(A;;GA;;;{})", user_sid()?));
            let mut descriptor = null_mut();
            anyhow::ensure!(
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut descriptor,
                    null_mut()
                ) != 0,
                "Cannot set IPC permissions"
            );
            Ok(Self {
                attributes: SECURITY_ATTRIBUTES {
                    nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                    lpSecurityDescriptor: descriptor,
                    bInheritHandle: 0,
                },
                descriptor,
            })
        }
    }
}
impl Drop for SecurityDescriptor {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.descriptor);
        }
    }
}
const MAX_FRAME: usize = 16 * 1024 * 1024;
fn read_exact(h: HANDLE, len: usize) -> Result<Vec<u8>> {
    unsafe {
        anyhow::ensure!(len <= MAX_FRAME, "IPC message too large");
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut out = vec![0; len];
        let mut pos = 0;
        while pos < len {
            let mut available = 0;
            anyhow::ensure!(
                PeekNamedPipe(h, null_mut(), 0, null_mut(), &mut available, null_mut()) != 0,
                "IPC disconnected"
            );
            if available == 0 {
                anyhow::ensure!(Instant::now() < deadline, "IPC read timeout");
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            let mut read = 0;
            anyhow::ensure!(
                ReadFile(
                    h,
                    out[pos..].as_mut_ptr(),
                    (len - pos).min(available as usize) as u32,
                    &mut read,
                    null_mut()
                ) != 0
                    && read > 0,
                "IPC read failed"
            );
            pos += read as usize;
        }
        Ok(out)
    }
}
fn read_json<T: serde::de::DeserializeOwned>(h: HANDLE) -> Result<T> {
    let header = read_exact(h, 4)?;
    let len = u32::from_le_bytes(header.try_into().unwrap()) as usize;
    Ok(serde_json::from_slice(&read_exact(h, len)?)?)
}
fn write_json<T: Serialize>(h: HANDLE, v: &T) -> Result<()> {
    unsafe {
        let payload = serde_json::to_vec(v)?;
        anyhow::ensure!(
            payload.len() <= MAX_FRAME,
            "Export exceeds 16 MB; use a smaller date range"
        );
        let bytes = [&(payload.len() as u32).to_le_bytes()[..], &payload].concat();
        let mut offset = 0;
        let deadline = Instant::now() + Duration::from_secs(10);
        while offset < bytes.len() {
            let mut written = 0;
            let ok = WriteFile(
                h,
                bytes[offset..].as_ptr(),
                (bytes.len() - offset).min(32768) as u32,
                &mut written,
                null_mut(),
            );
            if ok == 0 {
                anyhow::ensure!(GetLastError() == ERROR_NO_DATA, "IPC write failed");
            }
            offset += written as usize;
            if written == 0 {
                anyhow::ensure!(Instant::now() < deadline, "IPC write timeout");
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        Ok(())
    }
}
pub fn call(request: &Request) -> Result<serde_json::Value> {
    unsafe {
        let name = pipe_name()?;
        let deadline = Instant::now() + Duration::from_millis(1500);
        let handle = loop {
            let h = CreateFileW(
                name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                null(),
                OPEN_EXISTING,
                0,
                null_mut(),
            );
            if h != INVALID_HANDLE_VALUE {
                break h;
            }
            anyhow::ensure!(
                Instant::now() < deadline,
                "Collector unavailable. Open Trace from the installed folder."
            );
            WaitNamedPipeW(name.as_ptr(), 30);
            std::thread::sleep(Duration::from_millis(5));
        };
        let handle = Handle(handle);
        write_json(handle.0, request)?;
        let reply = read_json::<Response>(handle.0)?;
        let mut written = 0;
        WriteFile(handle.0, [1u8].as_ptr(), 1, &mut written, null_mut());
        reply.result()
    }
}
pub type Envelope = (Request, mpsc::SyncSender<Response>);
pub fn serve(tx: mpsc::SyncSender<Envelope>) -> Result<()> {
    unsafe {
        let name = pipe_name()?;
        let security = SecurityDescriptor::current_user()?;
        let h = CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            65536,
            65536,
            1000,
            &security.attributes,
        );
        anyhow::ensure!(
            h != INVALID_HANDLE_VALUE,
            "Cannot create Trace named pipe: {}",
            GetLastError()
        );
        let _handle = Handle(h);
        loop {
            loop {
                if ConnectNamedPipe(h, null_mut()) != 0 || GetLastError() == ERROR_PIPE_CONNECTED {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let result = (|| -> Result<()> {
                let request: Request = read_json(h)?;
                let (reply_tx, reply_rx) = mpsc::sync_channel(1);
                tx.try_send((request, reply_tx))
                    .map_err(|error| match error {
                        mpsc::TrySendError::Full(_) => {
                            anyhow::anyhow!("Collector busy; retry shortly")
                        }
                        mpsc::TrySendError::Disconnected(_) => {
                            anyhow::anyhow!("Collector worker stopped. Restart Trace.")
                        }
                    })?;
                let reply = reply_rx.recv_timeout(Duration::from_secs(10))?;
                write_json(h, &reply)?;
                Ok(())
            })();
            if let Err(e) = result {
                let _ = write_json(h, &Response::err(e));
            }
            // The client acknowledges the response before the server disconnects the pipe.
            let _ = read_exact(h, 1);
            DisconnectNamedPipe(h);
        }
    }
}
