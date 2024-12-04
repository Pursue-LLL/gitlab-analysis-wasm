fn main() {
  println!("cargo:rustc-check-cfg=cfg(wasm_bindgen_unstable_test_coverage)");
}