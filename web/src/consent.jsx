// Decision 25: DRAFT personal-data notice. The forum must confirm the wording, the data
// controller's name and the contact window before launch.
export function ConsentText() {
  return (
    <div className="consent">
      <h3>個資使用說明（草稿）</h3>
      <p>文化扭蛋機由台東文化願景論壇（以下稱主辦方）維運。為了讓扭蛋交換能進行，我們會蒐集你填寫的 Email、暱稱、所在地區、自我介紹，以及 LINE ID、Instagram、電話等聯絡方式。</p>
      <ul>
        <li><b>用途</b>：只用於文化扭蛋的登入、通知與媒合，不做行銷，也不提供給其他第三人。</li>
        <li><b>誰會看到</b>：抽中前，沒有人看得到你的資料。你的扭蛋被抽中時，抽到的參與者會看到你的暱稱、地區、自我介紹與聯絡方式；你抽到別人的扭蛋時，對方也會看到你的這些資料。Email 只有在你勾選公開時才會顯示。主辦方管理者可以在後台看到所有資料。</li>
        <li><b>保存</b>：保存到你要求刪除為止。</li>
        <li><b>你的權利</b>：你可以隨時聯絡主辦方，查詢、更正或要求刪除你的資料（聯絡窗口待主辦方確認）。</li>
      </ul>
      <p>交換是參與者之間自主進行的，主辦方不參與、不擔保交換內容。請在自主、知情、雙方同意的前提下交換。</p>
    </div>
  );
}
