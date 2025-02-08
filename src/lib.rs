// 该项目仅支持 web 环境

use futures::future::join_all;
use js_sys::{Array, Promise, Date, Object, Reflect};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, RequestMode, Response, console, AbortController, Headers, window};

// === 配置相关类型 ===
#[derive(Serialize, Deserialize)]
pub struct Config {
    gitlab_api: String,
    gitlab_token: String,
    group_id: String,
    start_date: String,
    end_date: String,
    projects_num: u32,
    excluded_projects: Vec<String>,
    valid_extensions: Vec<String>,
    max_concurrent_requests: u32,
    ignored_paths: Vec<String>,
}

// === 统计相关类型 ===
#[derive(Serialize, Deserialize, Default, Debug)]
struct Stats {
    additions: u32,
    deletions: u32,
    lines: u32,
    files: u32,
    size: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct AuthorStats {
    author_name: String,
    author_email: String,
    projects: HashMap<String, ProjectStats>,
    total_commits: u32,
    total_additions: u32,
    total_deletions: u32,
    total_lines: u32,
    total_files: u32,
    total_size: u64,
    commit_details: Vec<CommitDetail>,
}

#[derive(Serialize, Deserialize, Default, Debug)]
struct ProjectStats {
    commits: u32,
    additions: u32,
    deletions: u32,
    lines: u32,
    files: u32,
    size: u64,
}

// === 错误处理相关类型 ===
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FailureRecord {
    pub url: String,
    pub project_name: Option<String>,
    pub author: Option<String>,
    pub operation: String,
    pub error: String,
}

// === HTTP 请求相关类型 ===
struct RequestConfig {
    url: String,
    token: String,
    operation: String,
    timeout: i32,
    retries: u32,
}

enum ResponseResult {
    Success(JsValue),
    Retry,
}

// === GitLab API 相关类型 ===
#[derive(Serialize, Deserialize, Clone)]
struct Project {
    id: i64,
    name: String,
}

#[derive(Serialize, Deserialize)]
struct Commit {
    id: String,
    author_email: String,
    author_name: String,
    message: String,
    committed_date: String,
}

#[derive(Serialize, Deserialize)]
struct DiffInfo {
    old_path: Option<String>,
    new_path: Option<String>,
    diff: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct BranchInfo {
    branches: String,
    tags: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct RefInfo {
    #[serde(rename = "type")]
    ref_type: String,
    name: String,
}

// === 报告相关类型 ===
#[derive(Serialize, Deserialize, Debug)]
struct Report {
    #[serde(rename = "codeStats")]
    code_stats: Vec<CodeStat>,
    #[serde(rename = "commitStats")]
    commit_stats: Vec<CommitStat>,
    #[serde(rename = "failureStats", skip_serializing_if = "Option::is_none")]
    failure_stats: Option<Vec<FailureRecord>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct CodeStat {
    key: String,
    author: String,
    email: String,
    project: String,
    commits: u32,
    additions: u32,
    deletions: u32,
    lines: u32,
    files: u32,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none", rename = "isTotal")]
    is_total: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<CodeStat>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct CommitStat {
    author: String,
    email: String,
    project: String,
    branch: String,
    tag: String,
    #[serde(rename = "committedDate")]
    committed_date: String,
    message: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct CommitDetail {
    project: String,
    branch: String,
    tag: String,
    message: String,
    committed_date: String,
}

// === 常量定义 ===
static MERGE_BRANCH_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"Merge branch '([^']+)'").unwrap());

// === 实现部分 ===
// 通用的请求构建函数
fn build_request(config: &RequestConfig) -> Result<(Request, AbortController), JsValue> {
    let opts = RequestInit::new();
    opts.set_method("GET");
    opts.set_mode(RequestMode::Cors);

    let headers = Headers::new()?;
    headers.append("Private-Token", &config.token)?;
    headers.append("Content-Type", "application/json")?;
    opts.set_headers(&headers);

    let abort_controller = AbortController::new()?;
    opts.set_signal(Some(&abort_controller.signal()));

    let request = Request::new_with_str_and_init(&config.url, &opts)?;

    Ok((request, abort_controller))
}

// 添加错误类型枚举
enum RequestError<'a> {
    Http(&'a Response),
    Timeout(&'a str),
    Network(&'a str),
}

// 合并的错误日志记录函数
fn log_request_error(
    error: RequestError,
    duration: f64,
    config: &RequestConfig,
    failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
    retry_count: u32,
    project_name: Option<String>,
    author: Option<String>,
) {
    let error_msg = match &error {
        RequestError::Http(response) => {
            format!("HTTP error! status: {} {}", response.status(), response.status_text())
        }
        RequestError::Timeout(msg) => msg.to_string(),
        RequestError::Network(msg) => format!("网络错误: {}", msg),
    };

    console::error_1(&format!("[请求失败] 耗时: {}ms", duration).into());
    console::error_1(&format!("错误信息: {}", error_msg).into());

    if retry_count >= config.retries {
        let failure_record = FailureRecord {
            url: config.url.replace(config.url.split_at(config.url.find("v4/").unwrap()).0, ""),
            project_name,
            author,
            operation: config.operation.clone(),
            error: error_msg,
        };

        if let Ok(mut stats) = failure_stats.lock() {

            stats.push(failure_record);
        }
    }
}

// 修改 handle_response 函数中的错误处理
async fn handle_response(
    response: Result<JsValue, JsValue>,
    start_time: &f64,
    abort_controller: &AbortController,
    config: &RequestConfig,
    retry_count: &u32,
    failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
    project_name: Option<String>,
    author: Option<String>,
) -> Result<ResponseResult, JsValue> {
    let end_time = Date::now();
    let duration = end_time - start_time;

    match response {
        Ok(response) => {
            if let Some(timeout_val) = check_timeout(&response)? {
                if timeout_val.is_truthy() {
                    abort_controller.abort();
                    console::log_1(
                        &format!(
                            "URL: {}",
                            config.url.replace(config.url.split_at(config.url.find("v4/").unwrap()).0, "")
                        )
                        .into(),
                    );
                    let timeout_msg = format!(
                        "{}，第{}次请求失败，请求超时{}",
                        config.operation,
                        retry_count + 1,
                        if retry_count + 1 < config.retries { "，开始重试..." } else { "" },
                    );
                    log_request_error(
                        RequestError::Timeout(&timeout_msg),
                        duration,
                        config,
                        failure_stats,
                        *retry_count + 1,
                        project_name,
                        author,
                    );
                    return Ok(ResponseResult::Retry);
                }
            }

            let response: Response = response.dyn_into()?;
            if response.ok() {
                let json_promise = response.json()?;
                let json_value = JsFuture::from(json_promise).await?;
                Ok(ResponseResult::Success(json_value))
            } else {
                log_request_error(
                    RequestError::Http(&response),
                    duration,
                    config,
                    failure_stats,
                    *retry_count + 1,
                    project_name,
                    author,
                );
                Ok(ResponseResult::Retry)
            }
        }
        Err(e) => {
            abort_controller.abort();
            log_request_error(
                RequestError::Network(&format!("{:?}", e)),
                duration,
                config,
                failure_stats,
                *retry_count + 1,
                project_name,
                author,
            );
            Ok(ResponseResult::Retry)
        }
    }
}

// 辅助函数：检查是否超时
fn check_timeout(response: &JsValue) -> Result<Option<JsValue>, JsValue> {
    if response.is_object() {
        let timeout_obj = Object::from(response.clone());
        if let Ok(timeout_val) = Reflect::get(&timeout_obj, &"timeout".into()) {
            return Ok(Some(timeout_val));
        }
    }
    Ok(None)
}

// 添加一个辅助函数来创建延迟
async fn delay(ms: i32) {
    let promise = Promise::new(&mut |resolve, _| {
        window()
            .unwrap()
            .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms)
            .unwrap();
    });
    JsFuture::from(promise).await.unwrap();
}

// 发起请求，包含失败重试逻辑
pub async fn fetch_with_retry(
  url: &str,
  token: &str,
  context: &JsValue,
  failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
) -> Result<JsValue, JsValue> {
  let details = Reflect::get(context, &"details".into())?;
  let operation = Reflect::get(&details, &"operation".into())?
      .as_string()
      .unwrap_or_default();
  let project_name = Reflect::get(&details, &"projectName".into())
      .ok()
      .and_then(|v| v.as_string());
  let author = Reflect::get(&details, &"authorEmail".into())
      .ok()
      .and_then(|v| v.as_string());

  let config = RequestConfig {
      url: url.to_string(),
      token: token.to_string(),
      operation: operation.clone(),
      timeout: 5000, // 超时时间
      retries: 20, // 重试次数
  };

  let mut retry_count = 1;

  loop {
      let (request, abort_controller) = build_request(&config)?;

      let start_time = Date::now();

      // 创建超时 Promise
      let timeout_promise = Promise::new(&mut |resolve, _reject| {
          let window = window().unwrap();
          let timeout_value = Object::new();
          Reflect::set(&timeout_value, &"timeout".into(), &JsValue::TRUE).unwrap();
          window
              .set_timeout_with_callback_and_timeout_and_arguments_1(
                  &resolve,
                  config.timeout,
                  &timeout_value,
              )
              .unwrap();
      });

      let fetch_promise = window().unwrap().fetch_with_request(&request);
      let race_promise = Promise::race(&Array::of2(&fetch_promise, &timeout_promise));

      match handle_response(
          JsFuture::from(race_promise).await,
          &start_time,
          &abort_controller,
          &config,
          &retry_count,
          failure_stats,
          project_name.clone(),
          author.clone(),
      )
      .await?
      {
          ResponseResult::Success(json_value) => return Ok(json_value),
          ResponseResult::Retry => {
              retry_count += 1;
              if retry_count >= config.retries {
                  return Err(JsValue::from_str("达到最大重试次数"));
              }
              // 在重试前等待 300ms
              delay(300).await;
              continue;
          }
      }
  }
}

// 主函数入口
#[wasm_bindgen]
pub async fn analyze_gitlab_projects(config: JsValue) -> Result<JsValue, JsValue> {
    let config: Config = serde_wasm_bindgen::from_value(config)?;
    let failure_stats = Arc::new(Mutex::new(Vec::new()));
    let author_stats = Arc::new(Mutex::new(HashMap::new()));

    // 获取项目列表
    let projects = get_group_projects(&config, &failure_stats).await?;
    console::log_1(&format!("[获取项目成功] 本次分析 {} 个项目", projects.len()).into());

    // 过滤排除的项目
    let filtered_projects: Vec<_> = projects
        .iter()
        .filter(|p| !config.excluded_projects.contains(&p.name))
        .collect();

    // 处理每个项目
    for chunk in filtered_projects.chunks(config.max_concurrent_requests as usize) {
        let futures: Vec<_> = chunk
            .iter()
            .map(|project| {
                let config = &config;
                let author_stats = Arc::clone(&author_stats);
                let failure_stats = Arc::clone(&failure_stats);

                async move { process_project(project, config, &author_stats, &failure_stats).await }
            })
            .collect();

        join_all(futures).await;
    }

    // 生成报告
    let author_stats = author_stats.lock().unwrap();
    let failure_stats = failure_stats.lock().unwrap();
    let report = generate_report(&author_stats, &failure_stats, &config);
    console::log_1(&format!("[生成报告成功！]").into());
    Ok(serde_wasm_bindgen::to_value(&report)?)
}

// 实现获取群组项目
async fn get_group_projects(
    config: &Config,
    failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
) -> Result<Vec<Project>, JsValue> {
    console::log_1(&format!("开始获取项目...").into());
    let url = format!(
        "{}/groups/{}/projects?per_page={}&include_subgroups=true&order_by=last_activity_at&sort=desc",
        config.gitlab_api, config.group_id, config.projects_num
    );

    let context = Object::new();
    Reflect::set(&context, &"type".into(), &"projects".into())?;
    let details = Object::new();
    Reflect::set(&details, &"operation".into(), &"获取项目列表...".into())?;
    Reflect::set(&context, &"details".into(), &details)?;

    let response = fetch_with_retry(&url, &config.gitlab_token, &context, failure_stats).await?;
    let projects: Vec<Project> = serde_wasm_bindgen::from_value(response)?;

    Ok(projects)
}

// 实现处理单个项目
async fn process_project(
    project: &Project,
    config: &Config,
    author_stats: &Arc<Mutex<HashMap<String, AuthorStats>>>,
    failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
) -> Result<(), JsValue> {
    console::log_1(&format!("开始分析项目... {}", project.name).into());
    let commits = get_project_commit_stats(
        project.id,
        &config.start_date,
        &config.end_date,
        &project.name,
        config,
        failure_stats,
    )
    .await?;

    for commit_batch in commits.chunks(config.max_concurrent_requests as usize) {
        let mut futures = Vec::new();

        for commit in commit_batch {
            futures.push(process_commit(
                commit,
                project,
                config,
                author_stats,
                failure_stats,
            ));
        }

        futures::future::join_all(futures).await;
    }
    console::log_1(&format!("[分析项目{}完成]", project.name).into());

    Ok(())
}

// 获取项目提交统计
async fn get_project_commit_stats(
    project_id: i64,
    since: &str,
    until: &str,
    project_name: &str,
    config: &Config,
    failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
) -> Result<Vec<Commit>, JsValue> {
    let mut all_commits = Vec::new();
    let mut page = 1;

    loop {
        let url = format!(
            "{}/projects/{}/repository/commits?since={}&until={}&per_page=100&page={}&all=true",
            config.gitlab_api, project_id, since, until, page
        );

        let context = Object::new();
        Reflect::set(&context, &"type".into(), &"commits".into())?;
        let details = Object::new();
        Reflect::set(&details, &"projectName".into(), &project_name.into())?;
        Reflect::set(&details, &"operation".into(), &"获取提交记录".into())?;
        Reflect::set(&context, &"details".into(), &details)?;

        let response =
            fetch_with_retry(&url, &config.gitlab_token, &context, failure_stats).await?;
        let commits: Vec<Commit> = serde_wasm_bindgen::from_value(response)?;

        if commits.is_empty() {
            break;
        }

        all_commits.extend(commits);
        page += 1;
    }

    Ok(all_commits)
}

// 处理单个提交
async fn process_commit(
    commit: &Commit,
    project: &Project,
    config: &Config,
    author_stats: &Arc<Mutex<HashMap<String, AuthorStats>>>,
    failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
) -> Result<(), JsValue> {
    let stats = analyze_commit_diffs(
        project.id,
        &project.name,
        &commit.id,
        &commit.author_email,
        config,
        failure_stats,
    )
    .await?;

    let mut branch_info = get_commit_branches(
        project.id,
        &commit.id,
        &project.name,
        &commit.author_email,
        config,
        failure_stats,
    )
    .await?;

    // 如果是合并提交,从提交信息中提取分支名
    if commit.message.starts_with("Merge branch") {
        if let Some(captures) = MERGE_BRANCH_RE.captures(&commit.message) {
            if let Some(matched_branch) = captures.get(1) {
                branch_info.branches = matched_branch.as_str().to_string();
            }
        }
    }

    // 获取锁并更新统计信息
    let mut author_stats = author_stats.lock().unwrap();
    let author_stat = author_stats
        .entry(commit.author_name.clone())
        .or_insert_with(|| AuthorStats {
            author_name: commit.author_name.clone(),
            author_email: commit.author_email.clone(),
            projects: HashMap::new(),
            total_commits: 0,
            total_additions: 0,
            total_deletions: 0,
            total_lines: 0,
            total_files: 0,
            total_size: 0,
            commit_details: Vec::new(),
        });

    let project_stats = author_stat
        .projects
        .entry(project.name.clone())
        .or_insert_with(ProjectStats::default);

    // 更新项目统计
    project_stats.commits += 1;
    project_stats.additions += stats.additions;
    project_stats.deletions += stats.deletions;
    project_stats.lines += stats.lines;
    project_stats.files += stats.files;
    project_stats.size += stats.size;

    // 更新总计
    author_stat.total_commits += 1;
    author_stat.total_additions += stats.additions;
    author_stat.total_deletions += stats.deletions;
    author_stat.total_lines += stats.lines;
    author_stat.total_files += stats.files;
    author_stat.total_size += stats.size;

    // 添加提交详情
    author_stat.commit_details.push(CommitDetail {
        project: project.name.clone(),
        branch: branch_info.branches,
        tag: branch_info.tags,
        message: commit.message.clone(),
        committed_date: commit.committed_date.clone(),
    });

    Ok(())
}

// 分析提交差异
async fn analyze_commit_diffs(
    project_id: i64,
    project_name: &str,
    commit_sha: &str,
    author_email: &str,
    config: &Config,
    failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
) -> Result<Stats, JsValue> {
    let url = format!(
        "{}/projects/{}/repository/commits/{}/diff",
        config.gitlab_api, project_id, commit_sha
    );

    let context = Object::new();
    Reflect::set(&context, &"type".into(), &"diffs".into())?;
    let details = Object::new();
    Reflect::set(&details, &"projectName".into(), &project_name.into())?;
    Reflect::set(&details, &"authorEmail".into(), &author_email.into())?;
    Reflect::set(&details, &"operation".into(), &"获取提交差异".into())?;
    Reflect::set(&context, &"details".into(), &details)?;

    let response = fetch_with_retry(&url, &config.gitlab_token, &context, failure_stats).await?;
    let diffs: Vec<DiffInfo> = serde_wasm_bindgen::from_value(response)?;

    let mut stats = Stats::default();

    for diff in diffs {
        let file_path = diff.new_path.unwrap_or(diff.old_path.unwrap_or_default());
        let ext = format!(".{}", file_path.split('.').last().unwrap_or(""));

        // 检查是否应该忽略此文件
        if config
            .ignored_paths
            .iter()
            .any(|path| file_path.contains(path))
        {
            continue;
        }

        // 检查文件扩展名是否在允许列表中
        if !config.valid_extensions.contains(&ext) {
            continue;
        }

        stats.files += 1;

        if let Some(diff_content) = diff.diff {
            let lines = diff_content.lines();
            for line in lines {
                if line.starts_with('+') && !line.starts_with("+++") {
                    stats.additions += 1;
                } else if line.starts_with('-') && !line.starts_with("---") {
                    stats.deletions += 1;
                }
            }

            stats.lines = stats.additions + stats.deletions;
            stats.size += diff_content.len() as u64;
        }
    }

    Ok(stats)
}

// 获取提交所属的分支
async fn get_commit_branches(
    project_id: i64,
    commit_sha: &str,
    project_name: &str,
    author_email: &str,
    config: &Config,
    failure_stats: &Arc<Mutex<Vec<FailureRecord>>>,
) -> Result<BranchInfo, JsValue> {
    let url = format!(
        "{}/projects/{}/repository/commits/{}/refs",
        config.gitlab_api, project_id, commit_sha
    );

    let context = Object::new();
    Reflect::set(&context, &"type".into(), &"refs".into())?;
    let details = Object::new();
    Reflect::set(&details, &"projectName".into(), &project_name.into())?;
    Reflect::set(&details, &"authorEmail".into(), &author_email.into())?;
    Reflect::set(
        &details,
        &"operation".into(),
        &"获取提交对应的分支信息".into(),
    )?;
    Reflect::set(&context, &"details".into(), &details)?;

    let response = fetch_with_retry(&url, &config.gitlab_token, &context, failure_stats).await?;
    let refs: Vec<RefInfo> = serde_wasm_bindgen::from_value(response)?;

    let branch = refs
        .iter()
        .find(|r| r.ref_type == "branch")
        .map(|r| r.name.clone())
        .unwrap_or_else(|| "unknown".to_string());

    let tag = refs
        .iter()
        .find(|r| r.ref_type == "tag")
        .map(|r| r.name.clone())
        .unwrap_or_else(|| "unknown".to_string());

    Ok(BranchInfo {
        branches: branch,
        tags: tag,
    })
}

fn generate_report(
    author_stats: &HashMap<String, AuthorStats>,
    failure_stats: &Vec<FailureRecord>,
    _config: &Config,
) -> Report {
    let mut code_stats = Vec::new();
    let mut commit_stats = Vec::new();

    // 先收集所有作者的统计数据
    for (author_name, author_stat) in author_stats {
        // 生成总计数据
        let mut total_stat = CodeStat {
            key: format!("{}-total", author_name),
            author: format!("【{}】", author_name),
            email: author_stat.author_email.clone(),
            project: "【总计】".to_string(),
            commits: author_stat.total_commits,
            additions: author_stat.total_additions,
            deletions: author_stat.total_deletions,
            lines: author_stat.total_lines,
            files: author_stat.total_files,
            size: (author_stat.total_size as f64 / 1024.0).round() as u64,
            is_total: Some(true),
            children: Some(Vec::new()),
        };

        // 生成各个项目详细数据
        let mut project_stats = Vec::new();
        for (project_name, stats) in &author_stat.projects {
            project_stats.push(CodeStat {
                key: format!("{}-{}", author_name, project_name),
                author: author_name.clone(),
                email: author_stat.author_email.clone(),
                project: project_name.clone(),
                commits: stats.commits,
                additions: stats.additions,
                deletions: stats.deletions,
                lines: stats.lines,
                files: stats.files,
                size: (stats.size as f64 / 1024.0).round() as u64,
                is_total: None,
                children: None,
            });
        }

        // 对项目详情按代码量排序
        project_stats.sort_by(|a, b| b.size.cmp(&a.size));

        total_stat.children = Some(project_stats);
        code_stats.push(total_stat);

        // 添加提交统计
        for detail in &author_stat.commit_details {
            commit_stats.push(CommitStat {
                author: author_stat.author_name.clone(),
                email: author_stat.author_email.clone(),
                project: detail.project.clone(),
                branch: detail.branch.clone(),
                tag: detail.tag.clone(),
                committed_date: detail.committed_date.clone(),
                message: detail.message.clone(),
            });
        }
    }

    // 对总计数据按代码量排序
    code_stats.sort_by(|a, b| b.size.cmp(&a.size));

    Report {
        code_stats,
        commit_stats,
        failure_stats: if !failure_stats.is_empty() {
            Some(failure_stats.clone())
        } else {
            None
        },
    }
}
