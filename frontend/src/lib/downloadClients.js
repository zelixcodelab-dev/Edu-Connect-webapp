import api from "@/lib/api";

export async function downloadClientsCsv(params, filename = "clients.csv") {
  const { data } = await api.get("/clients/export", { params, responseType: "blob" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
