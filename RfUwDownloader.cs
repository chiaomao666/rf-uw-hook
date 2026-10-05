using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace RfUwDownloader
{
    internal static class Program
    {
        private const string AllowedOrigin = "https://chiaomao666.github.io";
        private const string Prefix = "http://127.0.0.1:17642/";
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static string downloadRoot;

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            try
            {
                downloadRoot = ReadOrChooseRoot();
                RunServer();
            }
            catch (Exception exception)
            {
                MessageBox.Show(exception.Message, "RF UW 圖資下載器", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static string SettingsPath
        {
            get
            {
                var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "rf-uw-hook");
                Directory.CreateDirectory(folder);
                return Path.Combine(folder, "downloader-root.txt");
            }
        }

        private static string ReadOrChooseRoot()
        {
            if (File.Exists(SettingsPath))
            {
                var saved = File.ReadAllText(SettingsPath, Encoding.UTF8).Trim();
                if (Directory.Exists(saved)) return saved;
            }

            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "選擇圖資根資料夾（assets\\passionfruit）";
                if (dialog.ShowDialog() != DialogResult.OK || String.IsNullOrWhiteSpace(dialog.SelectedPath))
                    throw new InvalidOperationException("尚未選擇下載資料夾。重新執行程式後再選擇 assets\\passionfruit。");
                File.WriteAllText(SettingsPath, dialog.SelectedPath, Encoding.UTF8);
                return dialog.SelectedPath;
            }
        }

        private static void RunServer()
        {
            var listener = new HttpListener();
            listener.Prefixes.Add(Prefix);
            try { listener.Start(); }
            catch (HttpListenerException)
            {
                throw new InvalidOperationException("下載器已經在執行中；請保留原本的下載器視窗即可。");
            }

            using (var window = new NotifyIcon())
            {
                window.Icon = System.Drawing.SystemIcons.Application;
                window.Text = "RF UW 圖資下載器（執行中）";
                window.Visible = true;
                window.BalloonTipTitle = "RF UW 圖資下載器已啟動";
                window.BalloonTipText = "目標：" + downloadRoot + "\n保持程式開啟後，在網站按一鍵下載即可。";
                window.ShowBalloonTip(5000);
                while (listener.IsListening)
                {
                    var context = listener.GetContext();
                    Task.Factory.StartNew(() => Handle(context));
                }
            }
        }

        private static void AddCors(HttpListenerResponse response)
        {
            response.Headers["Access-Control-Allow-Origin"] = AllowedOrigin;
            response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
            response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            response.Headers["Access-Control-Allow-Private-Network"] = "true";
        }

        private static void Handle(HttpListenerContext context)
        {
            try
            {
                AddCors(context.Response);
                if (context.Request.HttpMethod == "OPTIONS") { Send(context, new { ok = true }); return; }
                if (context.Request.Url.AbsolutePath == "/status" && context.Request.HttpMethod == "GET")
                {
                    Send(context, new { ready = Directory.Exists(downloadRoot), rootName = new DirectoryInfo(downloadRoot).Name });
                    return;
                }
                if (context.Request.Url.AbsolutePath == "/download" && context.Request.HttpMethod == "POST")
                {
                    Download(context);
                    return;
                }
                Send(context, new { error = "找不到請求的功能。" }, 404);
            }
            catch (Exception exception)
            {
                try { Send(context, new { error = exception.Message }, 500); } catch { }
            }
        }

        private static void Download(HttpListenerContext context)
        {
            string requestText;
            using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding)) requestText = reader.ReadToEnd();
            var data = Json.DeserializeObject(requestText) as Dictionary<string, object>;
            if (data == null || !data.ContainsKey("assets")) throw new InvalidOperationException("缺少圖資清單。");
            var assets = data["assets"] as object[];
            if (assets == null) throw new InvalidOperationException("圖資清單格式錯誤。");

            var failed = new List<string>();
            var succeeded = 0;
            using (var client = new WebClient())
            {
                foreach (var itemObject in assets)
                {
                    try
                    {
                        var item = itemObject as Dictionary<string, object>;
                        if (item == null) throw new InvalidOperationException("圖資資料格式錯誤。");
                        var relativePath = Convert.ToString(item["path"]);
                        var url = Convert.ToString(item["url"]);
                        Validate(relativePath, url);
                        var destination = Path.Combine(downloadRoot, relativePath.Replace('/', Path.DirectorySeparatorChar));
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        client.DownloadFile(url, destination);
                        succeeded++;
                    }
                    catch (Exception exception)
                    {
                        failed.Add(exception.Message);
                    }
                }
            }
            if (failed.Count > 0) File.WriteAllLines(Path.Combine(downloadRoot, "download_failed.txt"), failed.ToArray(), Encoding.UTF8);
            Send(context, new { ok = succeeded, failed = failed });
        }

        private static void Validate(string relativePath, string url)
        {
            if (String.IsNullOrWhiteSpace(relativePath) || relativePath.Contains("..") || Path.IsPathRooted(relativePath))
                throw new InvalidOperationException("不安全的檔案路徑：" + relativePath);
            Uri parsed;
            if (!Uri.TryCreate(url, UriKind.Absolute, out parsed) || parsed.Scheme != "https" || parsed.Host != "media.komisureiya.com")
                throw new InvalidOperationException("不允許的下載網址。");
        }

        private static void Send(HttpListenerContext context, object body, int statusCode = 200)
        {
            var bytes = Encoding.UTF8.GetBytes(Json.Serialize(body));
            context.Response.StatusCode = statusCode;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.Close();
        }
    }
}
