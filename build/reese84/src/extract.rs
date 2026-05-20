use std::collections::{HashMap, HashSet};
use anyhow::Result;

use crate::utils::substr;

const SITEKEY_OFFSET: [f64; 2] = [0.01, 0.12];
const VERSION_NUM_OFFSET: [f64; 2] = [0.91, 0.98];
const DYNAMIC_FUNC_STR_OFFSET: [f64; 2] = [0.74, 0.8];
const NAVIGATOR_PROPERTY_KEYS_OFFSET: [f64; 2] = [0.84, 0.95];
const DIV_PROPERTY_KEYS_OFFSET: [f64; 2] = [0.82, 0.95];
const PAYLOAD_KEYS_OFFSET: [f64; 2] = [0.125, 1.0];

#[derive(Default, Clone)]
pub struct Extractor {
    pub st: u64,
    pub sr: u64,
    pub checksum_arr: Vec<u64>,

    pub keys_map: HashMap<String, Vec<String>>,
    pub keys_order: Vec<String>,

    pub sitekey: String,

    pub version_num_str: String,
    pub session_str: String,

    pub div_property_keys: Vec<String>,
    pub dynamic_func_str: String,

    pub navigator_property_keys: Vec<String>,
    pub navigator_property_value: String
}

impl Extractor {
    pub fn new() -> Self {
        Self {
            ..Default::default()
        }
    }

    const ST_SR_SKIP_FROM_RIGHT: usize = 300;

    fn extract_st_sr(&mut self, script: &str) {
        let offset = script[..script.len() - Self::ST_SR_SKIP_FROM_RIGHT].rfind("window.btoa").unwrap();
        let mut snippet = &script[offset..script.len() - Self::ST_SR_SKIP_FROM_RIGHT];

        let chars_to_skip = snippet.find('=').unwrap() + 1;
        snippet = &snippet[chars_to_skip+1..];

        let st_start = snippet.find('=').unwrap() + 1;
        let st_end = st_start + snippet[st_start..].find(';').unwrap();
        let st = &snippet[st_start..st_end];
        snippet = &snippet[st_end..];
        
        let sr_start = snippet.find('=').unwrap() + 1;
        let sr_end = sr_start + snippet[sr_start..].find(';').unwrap();
        let sr = &snippet[sr_start..sr_end];

        self.st = st.parse().unwrap();
        self.sr = sr.parse().unwrap();
    }
    
    fn extract_checksum_arr(&mut self, script: &str) {
        let offset = script.find("0^-1").unwrap();
        let snippet = &script[offset..];
        let start = snippet.find('[').unwrap() + 1;
        let end = snippet.find(']').unwrap();
        let arr: Vec<u64> = snippet[start..end].split(',').map(|x| x.parse().unwrap()).collect();
    
        self.checksum_arr = arr
    }

    pub fn extract_payload_keys(&mut self, script: &str) {
    
        let pieces: Vec<&str> = substr(script, PAYLOAD_KEYS_OFFSET).split(|c| c == '"' || c == '.' || c == ';' || c == ' ').collect();
    
        for i in 1..pieces.len() - 1 {
            let piece = pieces[i];
            let prev = pieces[i - 1];
            let next = pieces[i + 1];
            if prev.ends_with("[") && next.starts_with("]") {
                let offset = prev[0..prev.len()-1]
                    .rfind(|c| c != '_' && !char::is_alphanumeric(c))
                    .unwrap_or_else(||usize::MAX);
                let id = if offset == usize::MAX {
                    prev[0..prev.len() - 1].to_string()
                } else {
                    prev[offset + 1..prev.len() - 1].to_string()
                };
                let property = piece;
                if !self.keys_order.contains(&id) {
                    self.keys_order.push(id.clone())
                };
                self.keys_map.entry(id)
                    .or_insert_with(Vec::new)
                    .push(property.to_string());
            }
            else if piece.len() > 6 && pieces[i].contains("=") && !pieces[i - 1].ends_with("var") {

                let offset = pieces[i - 1].rfind(|c| c != '_' && !char::is_alphanumeric(c)).unwrap_or_else(||usize::MAX);
                let key = if offset == usize::MAX {
                    (&pieces[i - 1]).to_string()
                } else {
                    (&pieces[i - 1][offset + 1..]).to_string()
                };
    
                if key.len() < 2  || !key.chars().all(|c| c == '_' || char::is_alphanumeric(c)) {continue};
                let equal_sign_pos = pieces[i].rfind('=').unwrap();
                let property = &pieces[i][0..equal_sign_pos];
                if property.len() % 4 != 0 || !property.chars().all(|c| c == '_' || char::is_alphanumeric(c)) {continue};
                if !self.keys_order.contains(&key) {self.keys_order.push(key.clone())};
                    self.keys_map.entry(key)
                        .or_insert_with(Vec::new)
                        .push(property.to_string());
            }
        }
    
        for (_, value) in self.keys_map.iter_mut() {
            let mut seen: HashSet<&str> = HashSet::new();
            let mut result: Vec<String> = Vec::new();
            for item in value.iter() {
                if seen.insert(item) {
                    result.push(item.to_string());
                }
            }
            value.clear();
            value.extend(result);
        }
    }

    fn extract_sitekey(&mut self, script: &str) {
        let offset = (script.len() as f64 * SITEKEY_OFFSET[0]) as usize;
        let start = script[offset..].find("aih").unwrap();
        let end = script[offset + start..].find("',").unwrap();
        let index = offset + start;
        let sitekey = &script[index + 6..index + end];

        self.sitekey = sitekey.into();
    }

    fn extract_version_and_session_string(&mut self, script: &str) {
        let test: Vec<&str> = substr(script, VERSION_NUM_OFFSET).split(";").collect();
        for line in test {
            if line.contains("JSON") && line.contains("window.JSON.stringify(\"") && !line.contains("\"beta\"")  && !line.contains("\"stable\"") {
                if self.version_num_str.is_empty() {
                    self.version_num_str = line.split("\"")
                        .nth(1)
                        .unwrap()
                        .to_string();
                } else {
                    self.session_str = line.split("\"")
                        .nth(1)
                        .unwrap()
                        .to_string();
                    return
                }
            }
        }
        panic!("Version and session string");
    }

    fn extract_div_property_keys(&mut self, script: &str) {
        let test: Vec<&str> = substr(script, DIV_PROPERTY_KEYS_OFFSET).split("var").collect();
        for line in test {
            if line.contains("[[\"") && line.matches("],[").count() == 5 {
                let test: Vec<String> = line
                            .split("\"")
                            .skip(1)
                            .step_by(2)
                            .map(String::from)
                            .collect();
                self.div_property_keys = test;
                return
            }
        }
        panic!("extract_div_keys");
    }

    fn extract_dynamic_func_string(&mut self, script: &str) {
        let test: Vec<&str> = substr(script, DYNAMIC_FUNC_STR_OFFSET).split(";").collect();
        for line in test {
            if line.contains("var") && line.contains("\"+") {
                self.dynamic_func_str = line.split("\"")
                    .nth(1)
                    .unwrap()
                    .to_string();
                return
            }
        }
        panic!("extract_dynamic_func_string");
    }

    fn extract_navigator_property_keys(&mut self, script: &str) {
        let test: Vec<&str> = substr(script, NAVIGATOR_PROPERTY_KEYS_OFFSET).split("try{").collect();
        for line in test {
            if line.contains("in [[\"") {
                let test: Vec<String> = line
                            .split("\"")
                            .skip(1)
                            .step_by(2)
                            .map(String::from)
                            .collect();
                let len: usize = test.len();                
                let count: usize = (test.len() - 2) / 3;
                self.navigator_property_value = (test[len - 2]).to_string();
                self.navigator_property_keys = (&test[..count]).to_vec();
                return;
            }
        }
        panic!("extract_navigator_property_keys");
    }

    pub fn extract(&mut self, dynamic_script: &str, static_script: &str) -> Result<()> {
        self.extract_st_sr(dynamic_script);
        self.extract_checksum_arr(dynamic_script);
        self.extract_payload_keys(dynamic_script);
        self.extract_sitekey(static_script);
        
        self.extract_version_and_session_string(dynamic_script);
        self.extract_div_property_keys(dynamic_script);
        self.extract_dynamic_func_string(dynamic_script);
        self.extract_navigator_property_keys(dynamic_script);

        Ok(())
    }   
}