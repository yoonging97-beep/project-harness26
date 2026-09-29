export async function reorder(item: string) {
  return fetch("https://shop.example.com/api/order?item=" + encodeURIComponent(item), { method: "POST" });
}
