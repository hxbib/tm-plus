use std::{time::{SystemTime, UNIX_EPOCH}, vec};
use sha1::{Sha1, Digest};

use crate::device::DEVICE;

lazy_static::lazy_static! {
    static ref SCREEN_WIDTH: String = DEVICE["screen"]["width"].to_string();
    static ref SCREEN_HEIGHT: String = DEVICE["screen"]["height"].to_string();
}

static SHA1_SIZE: usize = 20;

pub fn get_unix_ts() -> u128 {
    let start = SystemTime::now();
    let since_the_epoch = start
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    return since_the_epoch.as_millis()
}

pub fn sha1(input: String) -> Vec<u8> {
    let mut sha1 = Sha1::new();
    sha1.update(input.as_bytes());
    let bytes: Vec<u8> = sha1.finalize().to_vec();
    return bytes;
}

pub fn solve_dynamic_func(seed: u64, dynamic_string: &str) -> String {
    let input: String = format!("{}{}", dynamic_string, seed);
    let bytes: Vec<u8> = sha1(input);
    let static_str: Vec<u8> = "y() { [native code] }"
        .chars()
        .enumerate()
        .map(|(i, c)| {
            c as u8 ^ bytes[i % SHA1_SIZE] & 127
        })
        .collect();
    String::from_utf8(static_str).unwrap()
}

pub fn calc_checksum(seed: &str, sr: String, user_agent: &str, checksum_arr: &Vec<u64>) -> u32 {
    let steps = vec![
        seed,
        &sr,
        user_agent,
        DEVICE["language"].as_str().unwrap(),
        SCREEN_WIDTH.as_str(),
        SCREEN_HEIGHT.as_str(),
        DEVICE["plugins_list"].as_str().unwrap(),
        DEVICE["window_property_descriptors"].as_str().unwrap()
    ];

    let mut checksum: i32 = -1;

    for input in steps {
        for char in input.as_bytes() {
            let index = (checksum ^ *char as i32) & 255;
            checksum = ((checksum as u32).wrapping_shr(8) ^ checksum_arr[index as usize] as u32) as i32;
        }
    }
    (checksum as u32 ^ u32::MAX).wrapping_shr(0)
}

pub fn substr(script: &str, relative_offset: [f64; 2]) -> &str {
    let len = script.len() as f64;
    let start = (len * relative_offset[0]) as usize;
    let end = (len as f64 * relative_offset[1]) as usize;
    &script[start..end]
}