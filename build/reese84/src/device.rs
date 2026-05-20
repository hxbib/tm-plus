use serde_json::Value;
use once_cell::sync::Lazy;

pub static DEVICE: Lazy<Value> = Lazy::new(|| {
    let json_str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/device.json"));
    let device: Value = serde_json::from_str(&json_str).unwrap();
    device
});