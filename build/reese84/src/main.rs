use std::io::{self, Read};
use reese84::reese::solve_reese;

fn main() {
    let mut script = String::new();
    io::stdin().read_to_string(&mut script).expect("failed to read stdin");
    let script = script.trim().to_string();
    if script.is_empty() {
        eprintln!("reese84: no input on stdin");
        std::process::exit(1);
    }

    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
              (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

    match solve_reese(script, ua.to_string()) {
        Ok(result) => {
            let out = serde_json::json!({
                "solution": result.solution,
                "sitekey":  result.sitekey,
            });
            println!("{}", out);
        }
        Err(e) => {
            eprintln!("reese84: solve error: {e}");
            std::process::exit(1);
        }
    }
}
