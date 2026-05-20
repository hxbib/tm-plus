use anyhow::{anyhow, Result};
#[cfg(not(debug_assertions))]
use rand::Rng;
use serde_json::Value;
use tokio::task::JoinError;

use crate::encoder::{assemble_encoders, Encoders};
use crate::payload::gen_sensor;
use crate::extract::Extractor;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ReeseTaskData {
    script: String,
    user_agent: String
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ReeseResult {
    pub solution: Value,
    pub sitekey: String
}

pub struct ReeseSolver<'a> {

    pub user_agent: String,

    pub seed: u64,
    pub dynamic_script: &'a str,
    pub static_script: &'a str,

    pub encoders: Encoders<'a>,
    pub extractor: Extractor,

    pub is_waf: bool
}

impl<'a> ReeseSolver<'a> {
    pub fn new(script: &'a String, user_agent: String) -> Result<Self> {

        #[cfg(not(debug_assertions))]
        let seed = rand::thread_rng().gen_range(0..1073741824);

        #[cfg(debug_assertions)]
        let seed = 0;

        let (dynamic_script, static_script) = if let Some(x) = script.split_once("\n") {
            x
        } else {
            return Err(anyhow!("Malformed script"))
        };
        
        Ok(
            Self {
                user_agent,
                seed: seed,
                dynamic_script,
                static_script,
                encoders: Encoders::empty(),
                extractor: Extractor::new(),

                is_waf: true
            }
        )
    }

    pub fn solve(mut self) -> Result<ReeseResult> {

        self.encoders = assemble_encoders(self.dynamic_script, self.seed, self.is_waf);
        self.extractor.extract(self.dynamic_script, self.static_script).unwrap();

        let (sensor, sitekey) = gen_sensor(&mut self);

        Ok(
            ReeseResult { solution: sensor, sitekey: sitekey }
        )
    }

}

pub async fn solve_reese_catching(script: String, user_agent: String) -> Result<ReeseResult, JoinError> {

    tokio::task::spawn(async move {
        let solver = ReeseSolver::new(&script, user_agent).unwrap();
        solver.solve().unwrap()
    })
    .await

}


pub fn solve_reese(script: String, user_agent: String) -> Result<ReeseResult> {

    let solver = ReeseSolver::new(&script, user_agent).unwrap();
    solver.solve()

}