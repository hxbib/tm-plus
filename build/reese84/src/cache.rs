use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{sync::Mutex, time::interval};

use once_cell::sync::Lazy;

use crate::{encoder::Encoder, extract::Extractor, utils::get_unix_ts};

#[derive(Clone)]
pub struct CacheEntry {
    pub encoders: Vec<Encoder>,
    pub extractor: Extractor,
    last_used: u128
}

#[derive(Default)]
pub struct Cache {
    inner: Mutex<HashMap<u64, CacheEntry>>
}

impl Cache {
    pub async fn insert(&self, sig: u64, encoders: Vec<Encoder>, extractor: Extractor) {
        self.inner.lock()
            .await
            .insert(sig, CacheEntry {
                encoders, 
                extractor,
                last_used: get_unix_ts()
            });
    }
    pub async fn get(&self, sig: u64) -> Option<CacheEntry> {
        match self.inner.lock().await.get_mut(&sig) {
            Some(e) => {
                e.last_used = get_unix_ts();
                Some(e.clone())
            },
            None => None
        }
    }

    const GC_INTERVAL: u64 = 60;
    const GC_TIMEOUT: u128 = 1000 * 60 * 10;

    pub async fn gc(&self) {
        let mut interval = interval(Duration::from_secs(Cache::GC_INTERVAL));
        interval.tick().await;

        loop {
            interval.tick().await;

            let now = get_unix_ts();
            let mut cache = self.inner.lock().await;

            let removable_sigs = cache.iter()
                .filter(|(_, v)| (now - v.last_used) > Cache::GC_TIMEOUT)
                .map(|p| *p.0)
                .collect::<Vec<u64>>();

            for sig in removable_sigs {
                cache.remove(&sig);
            }
        }
    }
}

pub static CACHE: Lazy<Arc<Cache>> = Lazy::new(|| {
    let cache = Arc::new(Cache::default());
    {
        let cache = Arc::clone(&cache);
        tokio::spawn(async move {cache.gc().await});
    }

    cache
});

#[cfg(test)]
mod tests {
    use std::time::Duration;
    use super::CACHE;

    #[tokio::test]
    async fn cache() {

        CACHE.get(100).await;
        tokio::time::sleep(Duration::from_secs(100)).await
    }
}