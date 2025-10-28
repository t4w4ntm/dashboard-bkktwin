using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Networking;

// <<< แก้ไข: สร้าง Class ให้ตรงกับข้อมูลจาก ThingSpeak
[System.Serializable]
public class ThingSpeakData
{
    public string created_at;
    public int entry_id;
    public string field1; // Klong San PM2.5
    public string field2; // Thon Buri PM2.5
    public string field3; // Bang Rak PM2.5
}

public class AirQualityMonitor : MonoBehaviour
{
    [Header("UI Elements")]
    [SerializeField] private Text klongSanAqiText;
    [SerializeField] private Text klongSanUgm3Text;
    [SerializeField] private Text klongSanStatusText;
    
    [SerializeField] private Text thonBuriAqiText;
    [SerializeField] private Text thonBuriUgm3Text;
    [SerializeField] private Text thonBuriStatusText;
    
    [SerializeField] private Text bangRakAqiText;
    [SerializeField] private Text bangRakUgm3Text;
    [SerializeField] private Text bangRakStatusText;
    
    [SerializeField] private Image klongSanProgressImage;
    [SerializeField] private Image thonBuriProgressImage;
    [SerializeField] private Image bangRakProgressImage;
    
    [Header("Settings")]
    // <<< แก้ไข: เปลี่ยน URL ให้ดึงทุก Field พร้อมกัน
    [SerializeField] private string thingSpeakURL = "https://api.thingspeak.com/channels/3027679/feeds/last.json?api_key=4M306YRQZ87072KV";
    [SerializeField] private float updateInterval = 15f; // อัพเดททุก 15 วินาที (เหมือนเว็บ)
    [SerializeField] private float animationSpeed = 0.5f;
    
    [Header("Progress Animation")]
    [SerializeField] private bool enableAnimation = true;
    
    // เก็บค่า PM2.5 และ AQI ของแต่ละเขต
    private float[] currentPM25Values = new float[3]; // [0]=Klong San, [1]=Thon Buri, [2]=Bang Rak
    private float[] currentAQIValues = new float[3];
    private float[] targetFillAmounts = new float[3];
    private float[] currentFillAmounts = new float[3];
    private float animationTime = 0f;
    private bool isAnimating = false;
    
    // Cache ข้อมูลล่าสุด
    private static float[] cachedPM25 = { 12.0f, 18.0f, 25.0f }; // ค่าเริ่มต้น
    private static float[] cachedAQI = { 0f, 0f, 0f };
    private static bool hasValidCache = false;
    
    void Start()
    {
        // แสดงค่าเริ่มต้นทันที
        SetInitialValues();
        StartCoroutine(UpdateAirQualityDataPeriodically());
    }
    
    void OnEnable()
    {
        // เรียกดึงข้อมูลทันทีเมื่อ GameObject ถูก activate
        if (gameObject.activeInHierarchy)
        {
            StartCoroutine(FetchAirQualityDataImmediate());
        }
    }
    
    private IEnumerator FetchAirQualityDataImmediate()
    {
        yield return StartCoroutine(FetchAirQualityData());
    }
    
    private void SetInitialValues()
    {
        // ใช้ cache ถ้ามี หรือแสดงค่าเริ่มต้น
        if (hasValidCache)
        {
            for (int i = 0; i < 3; i++)
            {
                currentPM25Values[i] = cachedPM25[i];
                currentAQIValues[i] = cachedAQI[i];
            }
            UpdateAllUI();
        }
        else
        {
            // แสดงค่าเริ่มต้นก่อนดึงข้อมูลจริง
            currentPM25Values[0] = 12.0f; // Klong San
            currentPM25Values[1] = 18.0f; // Thon Buri
            currentPM25Values[2] = 25.0f; // Bang Rak
            
            for (int i = 0; i < 3; i++)
            {
                currentAQIValues[i] = CalculateAQI(currentPM25Values[i]);
            }
            
            UpdateAllUI();
        }
    }
    
    void Update()
    {
        if (enableAnimation && isAnimating)
        {
            animationTime += Time.deltaTime * animationSpeed;
            
            // อัพเดท Fill Amount สำหรับทั้ง 3 เขต
            for (int i = 0; i < 3; i++)
            {
                currentFillAmounts[i] = Mathf.Lerp(currentFillAmounts[i], targetFillAmounts[i], animationTime);
            }
            
            if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = currentFillAmounts[0];
            if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = currentFillAmounts[1];
            if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = currentFillAmounts[2];
            
            if (animationTime >= 1f)
            {
                isAnimating = false;
                // ทำให้แน่ใจว่าค่าสุดท้ายถูกต้อง
                if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = targetFillAmounts[0];
                if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = targetFillAmounts[1];
                if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = targetFillAmounts[2];
            }
        }
    }
    
    private IEnumerator UpdateAirQualityDataPeriodically()
    {
        while (true)
        {
            yield return StartCoroutine(FetchAirQualityData());
            yield return new WaitForSeconds(updateInterval);
        }
    }
    
    private IEnumerator FetchAirQualityData()
    {
        using (UnityWebRequest request = UnityWebRequest.Get(thingSpeakURL))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    string jsonResponse = request.downloadHandler.text;
                    
                    // ตรวจสอบว่าได้ข้อมูลมาหรือไม่
                    if (!string.IsNullOrEmpty(jsonResponse) && jsonResponse.StartsWith("{"))
                    {
                        ThingSpeakData thingSpeakData = JsonUtility.FromJson<ThingSpeakData>(jsonResponse);
                        
                        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
                        string[] fields = { thingSpeakData.field1, thingSpeakData.field2, thingSpeakData.field3 };
                        
                        bool hasAnyValidData = false;
                        
                        // แปลงและเก็บค่า PM2.5 ทั้ง 3 เขต
                        for (int i = 0; i < 3; i++)
                        {
                            if (float.TryParse(fields[i], out float pm25Value))
                            {
                                currentPM25Values[i] = pm25Value;
                                currentAQIValues[i] = CalculateAQI(pm25Value);
                                
                                // Cache ข้อมูลล่าสุด
                                cachedPM25[i] = pm25Value;
                                cachedAQI[i] = currentAQIValues[i];
                                
                                hasAnyValidData = true;
                                
                                Debug.Log($"{districtNames[i]} - PM2.5: {pm25Value:F1} µg/m³, AQI: {currentAQIValues[i]:F0}");
                            }
                            else
                            {
                                Debug.LogWarning($"Failed to parse PM2.5 value for {districtNames[i]}: {fields[i]}");
                            }
                        }
                        
                        if (hasAnyValidData)
                        {
                            hasValidCache = true;
                            UpdateAllUI();
                            Debug.Log("Successfully fetched data for all districts");
                        }
                        else
                        {
                            Debug.LogError("No valid PM2.5 data from any district");
                            SetErrorState();
                        }
                    }
                    else
                    {
                        Debug.LogError("Empty or invalid JSON response from ThingSpeak");
                        SetErrorState();
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"Error parsing air quality data: {e.Message}");
                    SetErrorState();
                }
            }
            else
            {
                Debug.LogError($"Error fetching air quality data: {request.error}");
                SetErrorState();
            }
        }
    }
    
    private int CalculateAQI(float pm25)
    {
        // ... (ส่วนนี้เหมือนเดิม ไม่ต้องแก้ไข)
        if (pm25 <= 12.0f) return (int)Mathf.Lerp(0, 50, pm25 / 12.0f);
        if (pm25 <= 35.4f) return (int)Mathf.Lerp(51, 100, (pm25 - 12.1f) / (35.4f - 12.1f));
        if (pm25 <= 55.4f) return (int)Mathf.Lerp(101, 150, (pm25 - 35.5f) / (55.4f - 35.5f));
        if (pm25 <= 150.4f) return (int)Mathf.Lerp(151, 200, (pm25 - 55.5f) / (150.4f - 55.5f));
        if (pm25 <= 250.4f) return (int)Mathf.Lerp(201, 300, (pm25 - 150.5f) / (250.4f - 150.5f));
        if (pm25 <= 350.4f) return (int)Mathf.Lerp(301, 400, (pm25 - 250.5f) / (350.4f - 250.5f));
        if (pm25 <= 500.4f) return (int)Mathf.Lerp(401, 500, (pm25 - 350.5f) / (500.4f - 350.5f));
        return 500;
    }

    private string GetQualityStatus(float pm25)
    {
        // ... (ส่วนนี้เหมือนเดิม ไม่ต้องแก้ไข)
        if (pm25 <= 12.0f) return "Good";
        if (pm25 <= 35.4f) return "Moderate";
        if (pm25 <= 55.4f) return "Unhealthy for Sensitive Groups";
        if (pm25 <= 150.4f) return "Unhealthy";
        if (pm25 <= 250.4f) return "Very Unhealthy";
        return "Hazardous";
    }
    
    private void UpdateAllUI()
    {
        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
        Text[] aqiTexts = { klongSanAqiText, thonBuriAqiText, bangRakAqiText };
        Text[] ugm3Texts = { klongSanUgm3Text, thonBuriUgm3Text, bangRakUgm3Text };
        Text[] statusTexts = { klongSanStatusText, thonBuriStatusText, bangRakStatusText };
        
        for (int i = 0; i < 3; i++)
        {
            // อัพเดท AQI Text
            if (aqiTexts[i] != null)
                aqiTexts[i].text = currentAQIValues[i].ToString("F0");
            
            // อัพเดท PM2.5 Text
            if (ugm3Texts[i] != null)
                ugm3Texts[i].text = currentPM25Values[i].ToString("F1");
            
            // อัพเดท Status Text
            if (statusTexts[i] != null)
                statusTexts[i].text = GetQualityStatus(currentPM25Values[i]);
            
            // คำนวณ Fill Amount
            targetFillAmounts[i] = Mathf.Clamp01(currentAQIValues[i] / 500f);
        }
        
        if (enableAnimation)
        {
            isAnimating = true;
            animationTime = 0f;
        }
        else
        {
            // อัพเดทโดยไม่มี Animation
            if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = targetFillAmounts[0];
            if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = targetFillAmounts[1];
            if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = targetFillAmounts[2];
        }
    }
    
    private void SetErrorState()
    {
        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
        Text[] aqiTexts = { klongSanAqiText, thonBuriAqiText, bangRakAqiText };
        Text[] ugm3Texts = { klongSanUgm3Text, thonBuriUgm3Text, bangRakUgm3Text };
        Text[] statusTexts = { klongSanStatusText, thonBuriStatusText, bangRakStatusText };
        
        for (int i = 0; i < 3; i++)
        {
            if (aqiTexts[i] != null) aqiTexts[i].text = "Error";
            if (ugm3Texts[i] != null) ugm3Texts[i].text = "--";
            if (statusTexts[i] != null) statusTexts[i].text = "Connection Error";
        }
    }
}