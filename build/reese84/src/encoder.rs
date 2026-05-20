use std::collections::HashMap;

use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use serde_json;

use crate::{enums::EncoderIndices, keys::{DEFAULT_ENCODER_INDICES, WAF_ENCODER_INDICES}};

pub trait Encodable {
    fn prepare(&self) -> String;
}

impl Encodable for &str {
    fn prepare(&self) -> String {
        format!("\"{}\"", self)
    }
}

impl Encodable for String {
    fn prepare(&self) -> String {
        format!("\"{}\"", self)
    }
}

impl Encodable for i32 {
    fn prepare(&self) -> String {
        self.to_string()
    }
}

impl Encodable for u32 {
    fn prepare(&self) -> String {
        self.to_string()
    }
}

impl Encodable for u128 {
    fn prepare(&self) -> String {
        self.to_string()
    }
}

impl Encodable for usize {
    fn prepare(&self) -> String {
        self.to_string()
    }
}

impl Encodable for serde_json::Value {
    fn prepare(&self) -> String {
        let stringified = serde_json::to_string(&self).unwrap();
        escape_unicode(stringified)
    }
}

fn escape_unicode(unescaped: String) -> String {
    let mut escaped = String::new();
    for c in unescaped.chars() {
        if c as u8 >= 127 {
            escaped.push_str(&format!("\\u{:04x}", c as u8));
        } else {
            escaped.push(c as char);
        }
    }
    escaped
}

#[derive(Clone)]
struct Xorshift {
    encoder_seed: u64,
    session_seed: u64,
    iterations: u8
}

impl Xorshift {
    pub fn new(l0: u64, hi: u64, iterations: u8) -> Self {
        Xorshift { encoder_seed: l0, session_seed: hi, iterations: iterations }
    }

    fn generate(&mut self) -> u8 {
        let mut aa: i32 = self.encoder_seed as i32;
        let za = self.session_seed;
        self.encoder_seed = za;
        aa ^= aa << 23;
        aa ^= aa >> 17;
        aa ^= za as i32;
        aa ^= za as i32 >> 26;
        self.session_seed = aa as u64;
        ((self.encoder_seed + self.session_seed) & 255) as u8
    }

    pub fn fill(&mut self) -> Vec<u8> {
        let mut encoder_arr: Vec<u8> = Vec::new();
        for _ in 0..self.iterations {
            encoder_arr.push(self.generate());
        }
        return encoder_arr;
    }
}
#[derive(PartialEq, Clone)]
pub enum Modifiers {
    Switch = 0,
    LRShift = 1,
    IncludeEncArr = 2,
    TripleXor = 3,
    Rotate = 4,
    Reverse = 5,
    XorAdd = 6
}

#[derive(Clone)]
pub struct Encoder {
    pub _id: u64,
    pub session_seed: u64,
    encoder_iterations: u8,
    encode_arr: Vec<u8>,
    data: Vec<u8>,
    steps: Vec<Modifiers>,
    include_encode_arr_start: usize,
    include_encode_arr_end: usize,
    rotation_index: usize,
    rotation_indices: Vec<usize>,
    l_r_shift_index: usize,
    triple_xor_init_values: Vec<u8>,
    triple_xor_start_indeces: Vec<usize>,
    triple_xor_end_indeces: Vec<usize>,
    xor_add_start_indeces: Vec<usize>,
    xor_add_end_indeces: Vec<usize>,
    l_r_shift_indeces: Vec<usize>,
    triple_xor_index: usize,
    xor_add_index: usize,
}

impl std::ops::Index<EncoderIndices> for Vec<Encoder> {
    type Output = Encoder;

    fn index(&self, index: EncoderIndices) -> &Self::Output {
        &self[index as usize]
    }
}

impl std::ops::IndexMut<EncoderIndices> for Vec<Encoder> {
    fn index_mut(&mut self, index: EncoderIndices) -> &mut Self::Output {
        &mut self[index as usize]
    }
}

impl Encoder {

    pub fn new(encoder_seed: u64, session_seed: u64, encoder_iterations: u8) -> Self {
        Encoder { 
            _id: encoder_seed,
            session_seed: session_seed,
            encoder_iterations,
            encode_arr: Xorshift::new(encoder_seed, session_seed, encoder_iterations).fill(),
            data: vec![],
            steps: vec![],
            include_encode_arr_start: 0,
            include_encode_arr_end: 0,
            rotation_index: 0,
            l_r_shift_index: 0,
            triple_xor_init_values: Vec::new(),
            triple_xor_start_indeces: Vec::new(),
            triple_xor_end_indeces: Vec::new(),
            xor_add_start_indeces: Vec::new(),
            xor_add_end_indeces: Vec::new(),
            rotation_indices: Vec::new(),
            l_r_shift_indeces: Vec::new(),
            triple_xor_index: 0,
            xor_add_index: 0,
        }
    }

    pub fn update_session_seed(&mut self, session_seed: u64) {
        self.session_seed = session_seed;
        self.encode_arr = Xorshift::new(self._id, session_seed, self.encoder_iterations).fill()
    }

    fn reset(&mut self) {
        self.triple_xor_index = 0;
        self.xor_add_index = 0;
        self.rotation_index = 0;
        self.l_r_shift_index = 0;
    }

    pub fn set_include_encode_arr_values(&mut self, start: usize, end: usize) {
        self.include_encode_arr_start = start;
        self.include_encode_arr_end = end;
    }

    pub fn add_rotate_index(&mut self, index: usize) {
        self.rotation_indices.push(index)
    }

    pub fn add_l_r_shift_index(&mut self, index: usize) {
        self.l_r_shift_indeces.push(index)
    }

    pub fn add_triple_xor_values(&mut self, val: u8, start: usize, end: usize) {
        self.triple_xor_init_values.push(val);
        self.triple_xor_start_indeces.push(start);
        self.triple_xor_end_indeces.push(end);
    }

    pub fn add_xor_add_values(&mut self, start: usize, end: usize) {
        self.xor_add_start_indeces.push(start);
        self.xor_add_end_indeces.push(end);
    }

    fn switch_pairs(&mut self) {
        let max_index = self.data.len() / 2;
        for i in 0..max_index {
            self.data.swap(i * 2, i * 2 + 1)
        }
    }

    fn left_right_shift_or(&mut self) {
        let max_index = self.data.len();
        let shift_count = self.encode_arr[self.l_r_shift_indeces[self.l_r_shift_index]] % 7 + 1;
        for i in 0..max_index {
            self.data[i] = self.data[i] << shift_count | self.data[i] >> 8 - shift_count
        }
        self.l_r_shift_index += 1;
    }
    
    fn include_encode_arr(&mut self) {
        let max_index = self.data.len();
        let include_encode_arr_part = &self.encode_arr[self.include_encode_arr_start..self.include_encode_arr_end];
        let modulus = include_encode_arr_part.len();
        let mut output: Vec<u8> = Vec::new();
        for i in 0..max_index {
            output.push(self.data[i]);
            output.push(include_encode_arr_part[i % modulus]);
        }
        self.data = output;
    }

    fn triple_xor(&mut self) {

        let mut triple_xor_init_val = self.triple_xor_init_values[self.triple_xor_index];

        let max_index = self.data.len();
        let triple_xor_range = self.triple_xor_start_indeces[self.triple_xor_index]..self.triple_xor_end_indeces[self.triple_xor_index];
        let triple_xor_part = &self.encode_arr[triple_xor_range];
        let modulus = triple_xor_part.len();
        let mut output: Vec<u8> = Vec::new();
        for i in 0..max_index {
            let result = self.data[i] ^ triple_xor_part[i % modulus] ^ triple_xor_init_val;
            output.push(result);
            triple_xor_init_val = result;
        }
        self.data = output;
        self.triple_xor_index += 1
    } 

    fn rotate(&mut self) {
        let max_index = self.data.len();
        let mut output: Vec<u8> = Vec::new();
        for i in 0..max_index {
            output.push(self.data[((i + self.encode_arr[self.rotation_indices[self.rotation_index]] as usize) % max_index) as usize]);
        }
        self.data = output;
        self.rotation_index += 1;
    }

    fn reverse(&mut self) {
        self.data.reverse();
    }

    fn xor_add(&mut self) {
        let max_index = self.data.len();
        let xor_add_range = self.xor_add_start_indeces[self.xor_add_index]..self.xor_add_end_indeces[self.xor_add_index];
        let xor_add_part = &self.encode_arr[xor_add_range];
        let modulus = xor_add_part.len();
        let mut output: Vec<u8> = Vec::new();
        for i in 0..max_index {
            let val1 = xor_add_part[i % modulus] as u16 & 127;
            let result = (self.data[i] as u16 + val1) % 256 ^ 128;
            output.push(result as u8);
        }
        self.data = output;
        self.xor_add_index += 1;
    } 

    pub fn add_step(&mut self, id: Modifiers) {
        self.steps.push(id);
    }

    pub fn encode(&mut self, data: impl Encodable) -> String {

        self.reset();

        let temp = data.prepare();
        self.data = temp.as_bytes().to_vec();

        let mut steps = self.steps.clone().into_iter();
        loop {
            match steps.next() {
                Some(s) => match s {
                    Modifiers::Switch        => self.switch_pairs(),
                    Modifiers::LRShift       => self.left_right_shift_or(),
                    Modifiers::IncludeEncArr => self.include_encode_arr(),
                    Modifiers::TripleXor     => self.triple_xor(),
                    Modifiers::Rotate        => self.rotate(),
                    Modifiers::Reverse       => self.reverse(),
                    Modifiers::XorAdd        => self.xor_add()
                },
                None => break
            }
        }

        general_purpose::STANDARD.encode(&self.data)
    }
}

fn extract_range(parts: &Vec<&str>, i: usize) -> Vec<usize> {
    let start_index = parts[i].find(']').unwrap() + 2;
    let substr = &parts[i][start_index..];
    let end_index = substr.find(')').unwrap();
    (&parts[i][start_index..start_index + end_index]).split(",").map(|x| x.parse().unwrap()).collect()
}

fn extract_rotate_index(parts: &Vec<&str>, i: usize) -> usize {
    let end = parts[i].rfind("])%").unwrap();
    let start = parts[i].rfind("[").unwrap();
    (&parts[i][start + 1..end]).parse().unwrap()
}

fn extract_l_r_shift_index(parts: &Vec<&str>, i: usize) -> usize {
    let start = parts[i].find('[').unwrap() + 1;
    let end = parts[i].find(']').unwrap();
    (&parts[i][start..end]).parse().unwrap()
}

fn init_encoder(parts: &Vec<&str>, index: usize, session_seed: u64) -> Encoder {

    let iter_exp = parts[index];
    let seed_exp = parts[index - 3];

    let iter_start = iter_exp.find('<').unwrap() + 1;
    let iter_end = iter_exp.find(')').unwrap();
    let iterations: u8 = (&iter_exp[iter_start..iter_end]).parse().unwrap();

    let seed_start = seed_exp.rfind('(').unwrap() + 1;
    let seed_end = seed_exp.rfind(',').unwrap();
    let seed: u64 = (&seed_exp[seed_start..seed_end]).parse().unwrap();

    Encoder::new(seed, session_seed, iterations)
}

fn extract_modifiers(parts: &Vec<&str>, mut i: usize, encoder: &mut Encoder) -> usize {

    while parts[i].len() > 60 || !parts[i].starts_with("var ") || !parts[i].contains(".replace") {
        i += 1;
    }

    i += 4;

    while !parts[i].contains("window.btoa") {

        i += 1;

        if !parts[i].starts_with("while") {
            continue;
        }

        if parts[i].contains("+1<") {
            encoder.add_step(Modifiers::Switch);
        }
        else if parts[i].contains(">=0") {
            encoder.add_step(Modifiers::Reverse);
        }
        else if parts[i].contains(">>8") {
            let index = extract_l_r_shift_index(parts, i - 3);
            encoder.add_l_r_shift_index(index);
            encoder.add_step(Modifiers::LRShift);
        }
        else if parts[i].contains(".push") {
            if parts[i].contains("])%") {
                let index = extract_rotate_index(parts, i);
                encoder.add_rotate_index(index);
                encoder.add_step(Modifiers::Rotate);
            } else {
                let positions = extract_range(parts, i - 3);
                encoder.set_include_encode_arr_values(positions[0], positions[1]);
                encoder.add_step(Modifiers::IncludeEncArr);
            }
        }
        else if parts[i].contains("var") {
            if parts[i + 1].contains("&127") {
                let positions = extract_range(parts, i - 3);
                encoder.add_xor_add_values(positions[0], positions[1]);
                encoder.add_step(Modifiers::XorAdd);
            } else {
                let value: u8 = (&parts[i - 2][parts[i - 2].find('=').unwrap() + 1..]).parse().unwrap();
                let positions = extract_range(parts, i - 4);
                encoder.add_triple_xor_values(value, positions[0], positions[1]);
                encoder.add_step(Modifiers::TripleXor);
            }
        }
        else {println!("UNKNOWN PART: {}", parts[i]);}   
    }
    return i;
}

pub struct Encoders<'a> {
    encoder: Vec<Encoder>,
    index_mapper: &'a HashMap<EncoderIndices, usize>
}

impl<'a> Encoders<'a> {
    pub fn empty() -> Self {
        Self {
            encoder: Vec::new(),
            index_mapper: &DEFAULT_ENCODER_INDICES
        }
    }
    pub fn get_id(&self, encode_type: EncoderIndices) -> u64 {
        let encoder_index = self.index_mapper.get(&encode_type).unwrap();
        self.encoder[*encoder_index]._id
    }
    pub fn encode(&mut self, encode_type: EncoderIndices, data: impl Encodable) -> String {
        let encoder_index = self.index_mapper.get(&encode_type).unwrap();
        self.encoder[*encoder_index].encode(data)
    }
}

fn handle_nested_encoder(parts: &Vec<&str>, mut i: usize, session_seed: u64) -> usize {
    let mut encoder = init_encoder(parts, i, session_seed);
    i = extract_modifiers(&parts, i, &mut encoder);

    i
}

pub fn assemble_encoders(script: &str, session_seed: u64, is_waf: bool) -> Encoders<'_> {
    let parts: Vec<&str> = script.split(";").collect();

    let mut encoders: Vec<Encoder> = Vec::new();

    for mut i in 0..parts.len() {
        
        if 
            !parts[i].starts_with("while") || 
            !parts[i].contains("()&255") {continue;}

        let encoder_index = encoders.len();
        let encoder = init_encoder(&parts, i, session_seed);

        encoders.push(encoder);

        i += 1;

        loop {
            let part = parts[i];

            if !(part.len() > 60 || !part.starts_with("var ") || !part.contains(".replace")) {
                break
            }

            if part.starts_with("while") && part.contains("()&255") {
                i = handle_nested_encoder(&parts, i, session_seed);
            }
            i += 1;
        }

        extract_modifiers(&parts, i, &mut encoders[encoder_index]);

    }
    
    Encoders { 
        encoder: encoders,
        index_mapper: if is_waf { &WAF_ENCODER_INDICES } else { &DEFAULT_ENCODER_INDICES }
    }
}