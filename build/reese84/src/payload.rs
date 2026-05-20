use std::collections::HashMap;

use enum_index::IndexEnum;
use serde_json::{json, Value};
use rand::Rng;

use crate::keys::{DEFAULT_MAIN_KEY_INDICES, WAF_MAIN_KEY_INDICES};
use crate::reese::ReeseSolver;
use crate::utils::{calc_checksum, solve_dynamic_func, get_unix_ts};
use crate::enums::*;

use crate::device::DEVICE;

const MAIN_KEY_INDEX: usize = 7;

trait ToValue {
    fn to_value(self) -> Value;
}

impl ToValue for &Value {
    fn to_value(self) -> Value {
        self.clone()
    }
}

impl ToValue for Value {
    fn to_value(self) -> Value {
        self
    }
}

impl ToValue for String {
    fn to_value(self) -> Value {
        self.into()
    }
}

impl ToValue for bool {
    fn to_value(self) -> Value {
        self.into()
    }
}

impl ToValue for &str {
    fn to_value(self) -> Value {
        self.into()
    }
}



#[derive(Clone)]
struct Payload<'a> {
    keys: Vec<String>,
    map: serde_json::Map<String, Value>,

    main_indices_mapper: &'a HashMap<MainIndices, usize>
}

impl<'a> Payload<'a> {
    fn new(keys: Vec<String>, is_waf: bool) -> Self {
        Self {
            keys,
            map: serde_json::Map::new(),
            main_indices_mapper: if is_waf { &WAF_MAIN_KEY_INDICES } else { &DEFAULT_MAIN_KEY_INDICES }
        }
    }
    fn insert_main<V>(&mut self, key_index: MainIndices, value: V) 
    where
        V: ToValue, 
    {
        let index = self.main_indices_mapper.get(&key_index).unwrap();
        let key = self.keys.get(*index)
            .unwrap()
            .clone();
        self.map.insert(key, value.to_value());
    }
    fn insert<K, V>(&mut self, key: K, value: V)
    where
        K: TryInto<usize>,
        V:ToValue,
    {
        let key = self.keys.get(key.try_into().ok().unwrap())
            .unwrap()
            .clone();
        self.map.insert(key, value.to_value());
    }
    fn get(&self, key: &str) -> Option<&Value> {
        self.map.get(key)
    }
    fn keys(&self) -> Vec<&String> {
        self.map.keys().into_iter().collect()
    }
    fn to_string_pretty(&self) -> String {
        serde_json::to_string_pretty(&self.map).unwrap()
    }
    fn take(self) -> Value {
        self.map.into()
    }
}

pub fn gen_sensor(solver: &mut ReeseSolver) -> (serde_json::Value, String) {

    let extracted_data = &solver.extractor;

    let checksum = calc_checksum(&solver.seed.to_string(), extracted_data.sr.to_string(), &solver.user_agent, &solver.extractor.checksum_arr);

    let keys_map =                  &extracted_data.keys_map;
    let keys_order =                &extracted_data.keys_order;
    let sitekey =                   &extracted_data.sitekey;
    let version_num_str =           &extracted_data.version_num_str;
    let session_str =               &extracted_data.session_str;
    let div_property_keys =         &extracted_data.div_property_keys;
    let navigator_property_keys =   &extracted_data.navigator_property_keys;
    let navigator_property_value =  &extracted_data.navigator_property_value;

    let main_key_count = keys_map[&keys_order[MAIN_KEY_INDEX]].len();
    solver.is_waf = match main_key_count {
        60 => false,
        61 => true,
        _ => panic!("Unknown main_key count {main_key_count}")
    };
    
    let dynamic_func_res = solve_dynamic_func(solver.seed, &solver.extractor.dynamic_func_str);

    let telemetry_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::Telemetry as usize]];
    let telemetry = json!({
        &telemetry_keys[0]: [],
        &telemetry_keys[1]: [],
    });


    let languages_keys: &Vec<String> = &extracted_data.keys_map[&extracted_data.keys_order[SubkeyIndices::Languages as usize]];
    
    let languages = json!({
        &languages_keys[0]: DEVICE["languages"]["disabled"],
        &languages_keys[1]: DEVICE["languages"]["list"],
    });

    let mut rng = rand::thread_rng();
    let random_float: f64 = rng.gen();
    
    let now: u128 = get_unix_ts();
    let performance: f64 = random_float * 300.0 + 600.0;
    let timeline: f64 = performance - random_float * 2.0 + 5.0;
    let start: f64 = now as f64 - random_float * 400.0;
    let timings_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::Timings as usize]];
    let timings = json!({
        &timings_keys[0]: solver.encoders.encode(EncoderIndices::CurrentUnix, now.to_string()),
        &timings_keys[1]: solver.encoders.encode(EncoderIndices::CurrentUnix2, now.to_string()),
        &timings_keys[2]: solver.encoders.encode(EncoderIndices::Performance, performance.to_string()),
        &timings_keys[3]: solver.encoders.encode(EncoderIndices::Timeline, format!("{:.3}", timeline)),
        &timings_keys[4]: solver.encoders.encode(EncoderIndices::StartUnix, start.to_string()),
    });

    let mime_types_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::MimeTypes as usize]];
    let mime_types: serde_json::Value = DEVICE["mime_types"].as_array().unwrap().iter().map(|mime_type| {
        let plain = mime_type[1].as_object().unwrap();
        let data = json!({
            &mime_types_keys[0]: plain["suffix"],
            &mime_types_keys[1]: plain["content_type"],
            &mime_types_keys[2]: plain["plugin_name"]
        });
        return json!([mime_type[0], solver.encoders.encode(EncoderIndices::MimeTypesSub, data)])
    }).collect();


    let screen_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::Screen as usize]];
    let screen = json!({
        &screen_keys[0]: DEVICE["screen"]["width"],
        &screen_keys[1]: DEVICE["screen"]["height"],
        &screen_keys[2]: DEVICE["screen"]["availHeight"],
        &screen_keys[3]: DEVICE["screen"]["availLeft"],
        &screen_keys[4]: DEVICE["screen"]["availTop"],
        &screen_keys[5]: DEVICE["screen"]["availWidth"],
        &screen_keys[6]: DEVICE["screen"]["pixelDepth"],
        &screen_keys[7]: DEVICE["screen"]["innerWidth"],
        &screen_keys[8]: DEVICE["screen"]["innerHeight"],
        &screen_keys[9]: DEVICE["screen"]["outerWidth"],
        &screen_keys[10]: DEVICE["screen"]["outerHeight"],
        &screen_keys[11]: DEVICE["screen"]["pixelRatio"],
        &screen_keys[12]: DEVICE["screen"]["orientation_type"],
        &screen_keys[13]: DEVICE["screen"]["screenX"],
        &screen_keys[14]: DEVICE["screen"]["screenY"]
    });

    let plugin_functions_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::PluginFunctions as usize]];
    let plugin_functions = json!({
        &plugin_functions_keys[0]: DEVICE["plugin_functions_names"]["namedItem"],
        &plugin_functions_keys[1]: DEVICE["plugin_functions_names"]["item"],
        &plugin_functions_keys[2]: DEVICE["plugin_functions_names"]["refresh"]
    });

    let web_gl_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::WebGL as usize]];
    let canvas_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::Canvas as usize]];
    let canvas = json!({
        &canvas_keys[0]: DEVICE["canvas"]["point_in_path"],
        &canvas_keys[1]: DEVICE["canvas"]["webp_format"],
        &canvas_keys[2]: DEVICE["canvas"]["globalCompositeOperation_is_screen"],
        &web_gl_keys[0]: solver.encoders.encode(EncoderIndices::CanvasHash, DEVICE["canvas"]["hash"].as_str().unwrap())
    });

    let image_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::Image as usize]];
    let image = json!({
        &image_keys[1]: solver.encoders.encode(EncoderIndices::Image, DEVICE["image"]["dataURL"].as_str().unwrap())
    });

    let mut web_gl = Payload::new(web_gl_keys.clone(), false);
    web_gl.insert(0, solver.encoders.encode(EncoderIndices::WebGLHash, DEVICE["web_gl"]["hash"].as_str().unwrap()));
    web_gl.insert(2, &DEVICE["web_gl"]["supportedExtensions"]);
    web_gl.insert(3, &DEVICE["web_gl"]["line_width_range"]);
    web_gl.insert(4, &DEVICE["web_gl"]["point_size_range"]);
    web_gl.insert(5, &DEVICE["web_gl"]["alpha_bits"]);
    web_gl.insert(6, &DEVICE["web_gl"]["antialias"]);
    web_gl.insert(7, &DEVICE["web_gl"]["blue_bits"]);
    web_gl.insert(8, &DEVICE["web_gl"]["depth_bits"]);
    web_gl.insert(9, &DEVICE["web_gl"]["green_bits"]);
    web_gl.insert(10, &DEVICE["web_gl"]["max_anisotropy"]);
    web_gl.insert(11, &DEVICE["web_gl"]["max_combined_texture_image_units"]);
    web_gl.insert(12, &DEVICE["web_gl"]["max_cube_map_texture_size"]);
    web_gl.insert(13, &DEVICE["web_gl"]["max_fragment_uniform_vectors"]);
    web_gl.insert(14, &DEVICE["web_gl"]["max_renderbuffer_size"]);
    web_gl.insert(15, &DEVICE["web_gl"]["max_texture_image_units"]);
    web_gl.insert(16, &DEVICE["web_gl"]["max_texture_size"]);
    web_gl.insert(17, &DEVICE["web_gl"]["max_varying_vectors"]);
    web_gl.insert(18, &DEVICE["web_gl"]["max_vertex_attribs"]);
    web_gl.insert(19, &DEVICE["web_gl"]["max_vertex_texture_image_units"]);
    web_gl.insert(20, &DEVICE["web_gl"]["max_vertex_uniform_vectors"]);
    web_gl.insert(21, &DEVICE["web_gl"]["max_viewport_dims"]);
    web_gl.insert(22, &DEVICE["web_gl"]["red_bits"]);
    web_gl.insert(23, &DEVICE["web_gl"]["renderer"]);
    web_gl.insert(24, &DEVICE["web_gl"]["shading_language_version"]);
    web_gl.insert(25, &DEVICE["web_gl"]["stencil_bits"]);
    web_gl.insert(26, &DEVICE["web_gl"]["vendor"]);
    web_gl.insert(27, &DEVICE["web_gl"]["version"]);
    web_gl.insert(28, &DEVICE["web_gl"]["vertex_high_float_precision"]);
    web_gl.insert(29, &DEVICE["web_gl"]["vertex_high_float_rangeMin"]);
    web_gl.insert(30, &DEVICE["web_gl"]["vertex_high_float_rangeMax"]);
    web_gl.insert(31, &DEVICE["web_gl"]["vertex_medium_float_precision"]);
    web_gl.insert(32, &DEVICE["web_gl"]["vertex_medium_float_rangeMin"]);
    web_gl.insert(33, &DEVICE["web_gl"]["vertex_medium_float_rangeMax"]);
    web_gl.insert(34, &DEVICE["web_gl"]["vertex_low_float_precision"]);
    web_gl.insert(35, &DEVICE["web_gl"]["vertex_low_float_rangeMin"]);
    web_gl.insert(36, &DEVICE["web_gl"]["vertex_low_float_rangeMax"]);
    web_gl.insert(37, &DEVICE["web_gl"]["fragment_high_float_precision"]);
    web_gl.insert(38, &DEVICE["web_gl"]["fragment_high_float_rangeMin"]);
    web_gl.insert(39, &DEVICE["web_gl"]["fragment_high_float_rangeMax"]);
    web_gl.insert(40, &DEVICE["web_gl"]["fragment_medium_float_precision"]);
    web_gl.insert(41, &DEVICE["web_gl"]["fragment_medium_float_rangeMin"]);
    web_gl.insert(42, &DEVICE["web_gl"]["fragment_medium_float_rangeMax"]);
    web_gl.insert(43, &DEVICE["web_gl"]["fragment_low_float_precision"]);
    web_gl.insert(44, &DEVICE["web_gl"]["fragment_low_float_rangeMin"]);
    web_gl.insert(45, &DEVICE["web_gl"]["fragment_low_float_rangeMax"]);
    web_gl.insert(46, &DEVICE["web_gl"]["vertex_high_int_precision"]);
    web_gl.insert(47, &DEVICE["web_gl"]["vertex_high_int_rangeMin"]);
    web_gl.insert(48, &DEVICE["web_gl"]["vertex_high_int_rangeMax"]);
    web_gl.insert(49, &DEVICE["web_gl"]["vertex_medium_int_precision"]);
    web_gl.insert(50, &DEVICE["web_gl"]["vertex_medium_int_rangeMin"]);
    web_gl.insert(51, &DEVICE["web_gl"]["vertex_medium_int_rangeMax"]);
    web_gl.insert(52, &DEVICE["web_gl"]["vertex_low_int_precision"]);
    web_gl.insert(53, &DEVICE["web_gl"]["vertex_low_int_rangeMin"]);
    web_gl.insert(54, &DEVICE["web_gl"]["vertex_low_int_rangeMax"]);
    web_gl.insert(55, &DEVICE["web_gl"]["fragment_high_int_precision"]);
    web_gl.insert(56, &DEVICE["web_gl"]["fragment_high_int_rangeMin"]);
    web_gl.insert(57, &DEVICE["web_gl"]["fragment_high_int_rangeMax"]);
    web_gl.insert(58, &DEVICE["web_gl"]["fragment_medium_int_precision"]);
    web_gl.insert(59, &DEVICE["web_gl"]["fragment_medium_int_rangeMin"]);
    web_gl.insert(60, &DEVICE["web_gl"]["fragment_medium_int_rangeMax"]);
    web_gl.insert(61, &DEVICE["web_gl"]["fragment_low_int_precision"]);
    web_gl.insert(62, &DEVICE["web_gl"]["fragment_low_int_rangeMin"]);
    web_gl.insert(63, &DEVICE["web_gl"]["fragment_low_int_rangeMax"]);
    web_gl.insert(64, &DEVICE["web_gl"]["unmasked_vendor"]);
    web_gl.insert(65, &DEVICE["web_gl"]["unmasked_renderer"]);

    let web_gl = web_gl.take();

    let small_image_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::Image as usize]];
    let small_image = json!({
        &small_image_keys[1]: solver.encoders.encode(EncoderIndices::SmallImage, DEVICE["small_image"]["dataURL"].as_str().unwrap())
    });

    let web_gl_prototypes_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::WebGLPrototypes as usize]];
    let web_gl_prototypes = json!({
        &web_gl_prototypes_keys[0]: DEVICE["web_gl_prototypes"]["getParameter_name"],
        &web_gl_prototypes_keys[1]: DEVICE["web_gl_prototypes"]["getParameter_exists"]
    });

    let touch_data_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::TouchData as usize]];
    let touch_data = json!({
        &touch_data_keys[0]: DEVICE["touch_data"]["maxTouchPoints"],
        &touch_data_keys[1]: DEVICE["touch_data"]["can_create_touchEvent"],
        &touch_data_keys[2]: DEVICE["touch_data"]["ontouchstart_unequal_undefined"]
    });
    
    let video_checks_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::VideoChecks as usize]];
    let video_checks = json!({
        &video_checks_keys[0]: DEVICE["video_checks"]["can_play_ogg"],
        &video_checks_keys[1]: DEVICE["video_checks"]["can_play_mp4"],
        &video_checks_keys[2]: DEVICE["video_checks"]["can_play_webm"]
    });

    let audio_checks_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::AudioChecks as usize]];
    let audio_checks = json!({
        &audio_checks_keys[0]: DEVICE["audio_checks"]["can_play_ogg"],
        &audio_checks_keys[1]: DEVICE["audio_checks"]["can_play_mpeg"],
        &audio_checks_keys[2]: DEVICE["audio_checks"]["can_play_wav"],
        &audio_checks_keys[3]: DEVICE["audio_checks"]["can_play_xm4a"],
        &audio_checks_keys[4]: DEVICE["audio_checks"]["can_play_empty"],
        &audio_checks_keys[5]: DEVICE["audio_checks"]["can_play_mp4"]
    });

    let chrome_properties_extra_keys: &Vec<String> = &keys_map[&keys_order[ExtrakeyIndices::ChromeProperties as usize]];
    let chrome_properties_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::ChromeProperties as usize]];
    let chrome_app_checks = json!({
        &chrome_properties_keys[0]: DEVICE["chrome_properties"]["is_internet_explorer"],
        &chrome_properties_keys[1]: {
            &chrome_properties_extra_keys[0]: DEVICE["chrome_properties"]["chrome_app_checks"]["loadTimes_is_native"],
            &chrome_properties_extra_keys[1]: DEVICE["chrome_properties"]["chrome_app_checks"]["chrome_app_functions"],
            &chrome_properties_extra_keys[2]: DEVICE["chrome_properties"]["chrome_app_checks"]["chrome_app_properties"]
        },
        &chrome_properties_keys[2]: DEVICE["chrome_properties"]["webdriver"],
        &chrome_properties_keys[3]: DEVICE["chrome_properties"]["is_chrome"],
        &chrome_properties_keys[4]: DEVICE["chrome_properties"]["connection_rtt"],
        &chrome_properties_keys[5]: DEVICE["chrome_properties"]["duckduckgo"]
    });

    let random_properties_extra_keys: &Vec<String> = &keys_map[&keys_order[ExtrakeyIndices::RandomProperties as usize]];
    let random_properties_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::RandomProperties as usize]];
    let random_properties = json!({
        &random_properties_keys[0]: DEVICE["random_properties"]["history_length"],
        &random_properties_keys[1]: DEVICE["random_properties"]["hardware_concurrency"],
        &random_properties_keys[2]: DEVICE["random_properties"]["top_unequal_self"],
        &random_properties_keys[3]: DEVICE["random_properties"]["getBattery_exists"],
        &random_properties_keys[4]: DEVICE["random_properties"]["console_debug_name"],
        &random_properties_keys[5]: DEVICE["random_properties"]["debug_exists"],
        &random_properties_keys[6]: DEVICE["random_properties"]["phantom"],
        &random_properties_keys[7]: DEVICE["random_properties"]["callPhantom"],
        &random_properties_keys[8]: DEVICE["random_properties"]["empty_array"],
        &random_properties_keys[9]: DEVICE["random_properties"]["window_presistent"],
        &random_properties_keys[10]: DEVICE["random_properties"]["window_temporary"],
        &random_properties_keys[11]: {
            &random_properties_extra_keys[0]: DEVICE["random_properties"]["performanceObserver"]["supportedEntryTypes"]
        },
        &random_properties_keys[12]: DEVICE["random_properties"]["sentryInWindow"]
    });

    let protocol_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::Protocol as usize]];
    let protocol = json!({
        &protocol_keys[0]: DEVICE["protocol"]["location_protocol"]
    });

    let scripts_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::Scripts as usize]];
    let scripts = json!({
        &scripts_keys[0]: DEVICE["scripts"]["count"],
        &scripts_keys[1]: DEVICE["scripts"]["non_script_count"],
        &scripts_keys[2]: 0,
        &scripts_keys[4]: DEVICE["scripts"]["in_documentElement"],
        &scripts_keys[6]: DEVICE["scripts"]["in_head"],
        &scripts_keys[8]: DEVICE["scripts"]["in_body"]
    });

    let executed_functions_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::ExecutedFunctions as usize]];
    let executed_functions = json!({
        &executed_functions_keys[0]: DEVICE["executed_functions"]["func_1"],
        &executed_functions_keys[1]: DEVICE["executed_functions"]["func_2"],
        &executed_functions_keys[2]: DEVICE["executed_functions"]["func_3"],
        &executed_functions_keys[3]: dynamic_func_res,
    });

    let visual_viewport_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::VisualViewport as usize]];
    let visual_viewport = json!({
        &visual_viewport_keys[0]: DEVICE["visual_viewport"]["width"],
        &visual_viewport_keys[1]: DEVICE["visual_viewport"]["height"],
        &visual_viewport_keys[2]: DEVICE["visual_viewport"]["scale"],
    });

    let html_create_function_names = json!([
        solver.encoders.encode(EncoderIndices::HtmlCreateFunctionNames, json!([0,"createAttribute"])),
        solver.encoders.encode(EncoderIndices::HtmlCreateFunctionNames, json!([1,"createElement"])),
        solver.encoders.encode(EncoderIndices::HtmlCreateFunctionNames, json!([2,"createElementNS"])),
        solver.encoders.encode(EncoderIndices::HtmlCreateFunctionNames, json!([3,null])),
        solver.encoders.encode(EncoderIndices::HtmlCreateFunctionNames, json!([4,null])),
        solver.encoders.encode(EncoderIndices::HtmlCreateFunctionNames, json!([5,null])),
    ]);

    let div_block = json!([
        [div_property_keys[0],"n","n",true],
        [div_property_keys[1],"s","s",true],
        [div_property_keys[2],"s","s",true],
        [div_property_keys[3],"n","n",true],
        [div_property_keys[4],"s","s",true],
        [div_property_keys[5],"o","u",false]
    ]);

    let created_divs_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::CreatedDivs as usize]];
    let created_divs = json!({
        &created_divs_keys[0]: div_block,
    });

    let typeof_checks_extra_keys: &Vec<String> = &keys_map[&keys_order[ExtrakeyIndices::TypeofChecks as usize]];
    let typeof_checks_arr = DEVICE["typeof_checks"].as_array().unwrap().iter();
    let typeof_checks_values: Vec<String> = typeof_checks_arr.map(|func| {
        let obj = json!({
            &typeof_checks_extra_keys[0]: solver.encoders.encode(EncoderIndices::TypeofChecks, func["type_of"].as_str().unwrap()),
            &typeof_checks_extra_keys[1]: solver.encoders.encode(EncoderIndices::TypeofChecks, func["stringified_no_name"].as_str().unwrap().len()),
            &typeof_checks_extra_keys[2]: solver.encoders.encode(EncoderIndices::TypeofChecks, func["stringified_no_name"].as_str().unwrap().len()),
            &typeof_checks_extra_keys[3]: solver.encoders.encode(EncoderIndices::TypeofChecks, func["stringified_no_func"].as_str().unwrap()),
            &typeof_checks_extra_keys[4]: solver.encoders.encode(EncoderIndices::TypeofChecks, func["stringified_no_func"].as_str().unwrap()),
            &typeof_checks_extra_keys[5]: solver.encoders.encode(EncoderIndices::TypeofChecks, func["func_name"].as_str().unwrap()),
        });
        solver.encoders.encode(EncoderIndices::TypeofChecks, obj)
    }).collect();

    let typeof_checks_keys: &Vec<String> = &keys_map[&keys_order[SubkeyIndices::TypeofChecks as usize]];
    let typeof_checks = json!({
        &typeof_checks_keys[0]: typeof_checks_values[0],
        &typeof_checks_keys[1]: typeof_checks_values[1],
        &typeof_checks_keys[2]: typeof_checks_values[2],
        &typeof_checks_keys[3]: typeof_checks_values[3],
        &typeof_checks_keys[4]: typeof_checks_values[4],
        &typeof_checks_keys[5]: typeof_checks_values[5],
        &typeof_checks_keys[6]: typeof_checks_values[6],
        &typeof_checks_keys[7]: typeof_checks_values[7],
        &typeof_checks_keys[8]: typeof_checks_values[8],
        &typeof_checks_keys[9]: typeof_checks_values[9],
        &typeof_checks_keys[10]: typeof_checks_values[10]
    });

    let navigator_property_checks: serde_json::Value = navigator_property_keys.iter().map(|key| json!([key, navigator_property_value])).collect();

    let main_keys = keys_map[&keys_order[MAIN_KEY_INDEX]].clone();

    let mut payload = Payload::new(main_keys.clone(), solver.is_waf);
    payload.insert_main(MainIndices::Telemetry, telemetry);
    payload.insert_main(MainIndices::BasDetection, DEVICE["bas_detection"].clone());
    payload.insert_main(MainIndices::SiteKey, sitekey.as_str());
    payload.insert_main(MainIndices::StaticNum, solver.encoders.encode(EncoderIndices::StaticNum, 1));
    payload.insert_main(MainIndices::ScriptLoadTime, solver.encoders.encode(EncoderIndices::ScriptLoadTime, get_unix_ts()));
    payload.insert_main(MainIndices::ScriptInterrogationCounter, solver.encoders.encode(EncoderIndices::ScriptInterrogationCounter, 1));
    payload.insert_main(MainIndices::Slc, solver.encoders.encode(EncoderIndices::Slc, 1));
    payload.insert_main(MainIndices::Gcs, solver.encoders.encode(EncoderIndices::Gcs, serde_json::to_value(["onProtectionInitialized"]).unwrap()));
    payload.insert_main(MainIndices::PropertyChecks, DEVICE["property_checks"].clone());
    payload.insert_main(MainIndices::UserAgent, solver.user_agent.as_str());
    payload.insert_main(MainIndices::Language, DEVICE["language"].clone());
    payload.insert_main(MainIndices::Languages, languages);
    payload.insert_main(MainIndices::Timings, solver.encoders.encode(EncoderIndices::Timings, timings));
    payload.insert_main(MainIndices::MimeTypes, solver.encoders.encode(EncoderIndices::MimeTypes, mime_types));
    payload.insert_main(MainIndices::Screen, solver.encoders.encode(EncoderIndices::Screen, screen));
    payload.insert_main(MainIndices::TimezoneOffset, DEVICE["timezone_offset"].clone());
    payload.insert_main(MainIndices::IndexedDb, DEVICE["indexed_db"].clone());
    payload.insert_main(MainIndices::AddBehavior, DEVICE["add_behavior"].clone());
    payload.insert_main(MainIndices::OpenDatabase, DEVICE["open_database"].clone());
    payload.insert_main(MainIndices::CpuClass, DEVICE["cpu_class"].clone());
    payload.insert_main(MainIndices::Platform, DEVICE["platform"].clone());
    payload.insert_main(MainIndices::DoNotTrack, DEVICE["do_not_track"].clone());
    payload.insert_main(MainIndices::PluginList, DEVICE["plugins_list"].clone());
    payload.insert_main(MainIndices::PluginFunctions, plugin_functions);
    payload.insert_main(MainIndices::Canvas, solver.encoders.encode(EncoderIndices::Canvas, canvas));
    payload.insert_main(MainIndices::Image, image);
    payload.insert_main(MainIndices::WebGL, solver.encoders.encode(EncoderIndices::WebGL, web_gl));
    payload.insert_main(MainIndices::SmallImage, small_image);
    payload.insert_main(MainIndices::WebGLPrototypes, web_gl_prototypes);
    payload.insert_main(MainIndices::TouchData, solver.encoders.encode(EncoderIndices::TouchData, touch_data));
    payload.insert_main(MainIndices::VideoChecks, solver.encoders.encode(EncoderIndices::VideoChecks, video_checks));
    payload.insert_main(MainIndices::AudioChecks, solver.encoders.encode(EncoderIndices::AudioChecks, audio_checks));
    payload.insert_main(MainIndices::Vendor, &DEVICE["vendor"]);
    payload.insert_main(MainIndices::Product, &DEVICE["product"]);
    payload.insert_main(MainIndices::ProductSub, &DEVICE["productSub"]);
    payload.insert_main(MainIndices::ChromeProperties, solver.encoders.encode(EncoderIndices::ChromeProperties, chrome_app_checks));
    payload.insert_main(MainIndices::RandomProperties, solver.encoders.encode(EncoderIndices::RandomProperties, random_properties));
    payload.insert_main(MainIndices::Protocol, protocol);
    payload.insert_main(MainIndices::Fonts, &DEVICE["fonts"]);
    payload.insert_main(MainIndices::Scripts, scripts);
    payload.insert_main(MainIndices::ExecutedFunctions, solver.encoders.encode(EncoderIndices::ExecutedFunctions, executed_functions));
    payload.insert_main(MainIndices::WindowPropertyDescriptors, solver.encoders.encode(EncoderIndices::WindowPropertyDescriptors, DEVICE["window_property_descriptors"].as_str().unwrap()));
    payload.insert_main(MainIndices::BrowserOnEvents, solver.encoders.encode(EncoderIndices::BrowserOnEvents, json!([["onbeforeinstallprompt","gsec"],["onbeforexrselect","gsec"],["onbeforeinput","gsec"],["onbeforematch","gsec"],["onbeforetoggle","gsec"],["onblur","gsec"],["onbeforeprint","gsec"],["onbeforeunload","gsec"],["onunhandledrejection","gsec"],["onunload","gsec"]])));
    payload.insert_main(MainIndices::Window30PropertyNames, solver.encoders.encode(EncoderIndices::Window30PropertyNames, json!(["PushSubscrip$","RemotePlayba$","ScrollTimeli$","ViewTimeline","SharedWorker","SpeechSynthe$","SpeechSynthe$","SpeechSynthe$","SpeechSynthe$","SpeechSynthe$","VideoPlaybac$","VisibilitySt$","webkitSpeech$","webkitSpeech$","webkitSpeech$","webkitSpeech$","webkitSpeech$","webkitReques$","webkitResolv$","showBlockPag$","onProtection$","reeseSkipExp$","e","a1_0x1092","a1_0x21cc","reese84","reese84inter$","initializePr$","protectionSu$","protectionLo$"])));
    payload.insert_main(MainIndices::VisualViewport, solver.encoders.encode(EncoderIndices::VisualViewport, visual_viewport));
    payload.insert_main(MainIndices::HtmlCreateFunctionNames, html_create_function_names);
    payload.insert_main(MainIndices::HighSurrogate, solver.encoders.encode(EncoderIndices::HighSurrogate, json!([])));
    payload.insert_main(MainIndices::SkipReeseExpiration, true);

    if solver.is_waf {
        payload.insert_main(MainIndices::WafAlwaysTrue, true);
    }

    payload.insert_main(MainIndices::WorkerIsFunction, true);
    payload.insert_main(MainIndices::WebAssemblyIsObject, true);
    payload.insert_main(MainIndices::CreatedDivs, solver.encoders.encode(EncoderIndices::CreatedDivs, created_divs));
    payload.insert_main(MainIndices::TypeofChecks, solver.encoders.encode(EncoderIndices::TypeofChecks, typeof_checks));
    payload.insert_main(MainIndices::NavigatorPropertyChecks, solver.encoders.encode(EncoderIndices::NavigatorPropertyChecks, navigator_property_checks));
    payload.insert_main(MainIndices::Checksum, solver.encoders.encode(EncoderIndices::Checksum, checksum));
    payload.insert_main(MainIndices::VersionState, solver.encoders.encode(EncoderIndices::VersionState, DEVICE["version_state"].as_str().unwrap()));
    payload.insert_main(MainIndices::VersionNum, solver.encoders.encode(EncoderIndices::VersionNum, (*version_num_str).as_str()));
    payload.insert_main(MainIndices::SessionStr, solver.encoders.encode(EncoderIndices::SessionStr, (*session_str).as_str()));

    #[cfg(debug_assertions)]
    if std::env::var("DEBUG").ok() == Some("1".to_string()) {

        let legit_payload: serde_json::Map<String, Value> = serde_json::from_str(std::fs::read_to_string("./debug/legit_payload.json").unwrap().as_str())
            .unwrap();
        let legit_payload_keys = legit_payload.keys().into_iter().collect::<Vec<&String>>();

        let genned_payload = payload.clone();
        let genned_payload_keys = genned_payload.keys();

        for key in legit_payload_keys.iter() {
            if genned_payload_keys.contains(&key) {continue}
            println!("Key {key} not present in genned payload")
        }

        for key in genned_payload_keys.iter() {
            if legit_payload_keys.contains(&key) {continue}
            println!("Key {key} not present in legit payload")
        }

        let mut cnt = 0;
        for key in legit_payload_keys {
            if !genned_payload_keys.contains(&key) {continue}
            
            if genned_payload.get(key) != legit_payload.get(key) {
                let _index = main_keys.iter().position(|x| x == key).unwrap();
                println!("ineq {:?} {} index {}", MainIndices::index_enum(cnt).unwrap(), key, cnt);
            }
            cnt += 1;

        }

        println!("Checksum: {}", checksum);

        #[cfg(debug_assertions)]
        {
            use clipboard::ClipboardProvider;
            use clipboard::ClipboardContext;
            let mut ctx: ClipboardContext = ClipboardProvider::new().unwrap();
            let text = payload.to_string_pretty();
            ctx.set_contents(text.to_owned()).unwrap();
        }
    }

    let sensor = json!({
        "p": solver.encoders.encode(EncoderIndices::Payload, payload.take()),
        "st": extracted_data.st,
        "sr": extracted_data.sr,
        "cr": solver.seed,
        "og": 2
    });

    let solution = json!({
        "solution": {
            "interrogation": sensor,
            "version": DEVICE["version_state"].as_str().unwrap()
        },
        "old_token": null,
        "error": null,
        "performance": {
            "interrogation": get_unix_ts() % 200 + 180
        }
    });

    (solution, sitekey.to_string())
}